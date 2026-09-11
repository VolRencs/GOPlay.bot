import { after, NextResponse } from "next/server.js";
import { DiscordRateLimitError, discordFetch, guildRoute, isSnowflake, jsonError } from "../../../../../src/lib/guild-access.ts";
import { db, sleep, withTransaction } from "../../../../../src/db/database.ts";
import { safeJson, stableJson } from "../../../../../src/lib/json.ts";
import { recordDashboardChange, recordDashboardDiff } from "../../../../../src/lib/dashboard-audit.ts";
import { cleanupOrphanedFiles, embedUploadPrefix, embedUploadsDir, extractFilenames, rejectOversized } from "../../../../../src/lib/uploads.ts";
import { logger } from "../../../../../src/bot/utils/logger.ts";
import { BOT_TOKEN_ERROR } from "../../../../../src/lib/constants.ts";
import { AssetError, collectNewUploads, persistUploadedAssets, reattachStoredAssets, type StoredAsset } from "../../../../../src/lib/assets.ts";
import type { EmbedPayload, EmbedSending, EmbedsGet, SavedEmbed } from "../../../../../src/components/dashboard/types.ts";

type RequestData = { id?: number; saveOnly?: boolean; updateMessage?: boolean; name: string; channelId?: string; mode?: "embed" | "text"; payload: EmbedPayload };

// Statements готовятся один раз на модуль: SQL статический, параметры через `?`.
const embedListStmt = db.prepare("SELECT * FROM embeds WHERE guild_id=? ORDER BY updated_at DESC");
const sendingListStmt = db.prepare("SELECT s.id,s.embed_id,s.channel_id,s.message_id,s.sent_at FROM embed_sendings s WHERE s.guild_id=? ORDER BY s.sent_at DESC LIMIT 50");
const embedPayloadsStmt = db.prepare("SELECT payload_json FROM embeds WHERE guild_id=?");
const embedSaveUpdateStmt = db.prepare("UPDATE embeds SET name=?,payload_json=?,mode=?,channel_id=COALESCE(NULLIF(?,''),channel_id),updated_at=? WHERE id=? AND guild_id=?");
const embedSaveInsertStmt = db.prepare("INSERT INTO embeds(guild_id,name,payload_json,channel_id,mode,updated_at) VALUES(?,?,?,?,?,?)");
const embedByIdStmt = db.prepare("SELECT channel_id,message_id,payload_json,name,mode FROM embeds WHERE id=? AND guild_id=?");
const embedPublishUpdateStmt = db.prepare("UPDATE embeds SET name=?,payload_json=?,channel_id=?,message_id=?,mode=?,updated_at=? WHERE id=? AND guild_id=?");
const embedPublishInsertStmt = db.prepare("INSERT INTO embeds(guild_id,name,payload_json,channel_id,message_id,mode,updated_at) VALUES(?,?,?,?,?,?,?)");
const sendingInsertStmt = db.prepare("INSERT INTO embed_sendings(guild_id,embed_id,channel_id,message_id,sent_at) VALUES(?,?,?,?,?)");
const sendingByIdStmt = db.prepare("SELECT channel_id,message_id FROM embed_sendings WHERE id=? AND guild_id=?");
const sendingDeleteStmt = db.prepare("DELETE FROM embed_sendings WHERE id=? AND guild_id=?");
const sendingsByEmbedDeleteStmt = db.prepare("DELETE FROM embed_sendings WHERE embed_id=? AND guild_id=?");
const embedDeleteStmt = db.prepare("DELETE FROM embeds WHERE id=? AND guild_id=?");

function draftImageNames(payloadJson:string,guildId:string) {
  const payload=safeJson<{author?:{icon_url?:string};thumbnail?:{url?:string};image?:{url?:string}}>(payloadJson,{});
  return extractFilenames(embedUploadPrefix(guildId), [payload.author?.icon_url, payload.thumbnail?.url, payload.image?.url]);
}

async function cleanupUnusedDraftImages(guildId:string) {
  const referenced=new Set(embedPayloadsStmt.all(guildId).flatMap(row=>draftImageNames(String((row as {payload_json:string}).payload_json),guildId)));
  // Тот же часовой minAge, что у events: файл мог быть записан параллельным
  // сохранением, которое ещё не закоммитило ссылку в БД.
  await cleanupOrphanedFiles(embedUploadsDir(guildId), referenced, 60 * 60_000);
}

function payloadDisplay(payloadJson: string): Record<string, unknown> {
  const p = safeJson<Record<string, unknown>>(payloadJson, {});
  const fields = Array.isArray(p.fields) ? p.fields : [];
  const footer = p.footer as { text?: unknown } | undefined;
  const author = p.author as { name?: unknown } | undefined;
  const image = p.image as { url?: unknown } | undefined;
  const thumbnail = p.thumbnail as { url?: unknown } | undefined;
  return {
    "Заголовок": typeof p.title === "string" ? p.title : null,
    "Описание": typeof p.description === "string" ? p.description : null,
    "Цвет": typeof p.color === "number" ? `#${p.color.toString(16).padStart(6, "0")}` : null,
    "Футер": typeof footer?.text === "string" ? footer.text : null,
    "Автор": typeof author?.name === "string" ? author.name : null,
    "Изображение": typeof image?.url === "string" ? image.url : null,
    "Миниатюра": typeof thumbnail?.url === "string" ? thumbnail.url : null,
    "Поля": stableJson(fields),
  };
}

export const GET = guildRoute(async (request, { guildId }) => {
  const embeds=embedListStmt.all(guildId) as SavedEmbed[];
  let sendings=sendingListStmt.all(guildId) as EmbedSending[];
  const verify=new URL(request.url).searchParams.get("verify")==="1";
  if(verify&&process.env.DISCORD_TOKEN&&sendings.length>0){
    const staleIds:number[]=[];
    const CONCURRENCY=5;
    for(let i=0;i<sendings.length;i+=CONCURRENCY){
      const chunk=sendings.slice(i,i+CONCURRENCY);
      const results=await Promise.allSettled(chunk.map(async (s)=>{
        try{
          const res=await discordFetch(`/channels/${s.channel_id}/messages/${s.message_id}`, { signal: AbortSignal.timeout(5000) });
          if(res.status===404) return {id:s.id,stale:true};
          return {id:s.id,stale:false};
        }catch(e){
          if(e instanceof DiscordRateLimitError) logger.warn("[EMBEDS] Discord rate limit", guildId, e.retryAfterMs);
          return {id:s.id,stale:false};
        }
      }));
      for(const r of results) if(r.status==="fulfilled" && r.value.stale) staleIds.push(r.value.id);
      if(i+CONCURRENCY < sendings.length) await sleep(210);
    }
    if(staleIds.length>0){ db.prepare(`DELETE FROM embed_sendings WHERE id IN (${staleIds.map(()=>"?").join(",")})`).run(...staleIds); sendings=sendings.filter(s=>!staleIds.includes(s.id)); }
  }
  return NextResponse.json<EmbedsGet>({embeds,sendings});
});

export const POST = guildRoute(async (request, { guildId, user }) => {
  const oversized=rejectOversized(request); if(oversized) return oversized;
  const form=request.headers.get("content-type")?.includes("multipart/form-data")?await request.formData():null;
  let data:RequestData;
  try {
    const serialized=form?.get("data");
    data=(form?JSON.parse(typeof serialized==="string"?serialized:"{}"):await request.json()) as RequestData;
  } catch {
    return jsonError("Не удалось прочитать данные сообщения. Попробуйте выбрать изображение заново.");
  }
  if(!data||typeof data!=="object")return jsonError("Некорректные данные сообщения.");
  if(!data.payload||typeof data.payload!=="object")return jsonError("Некорректные данные сообщения.");
  if(typeof data.name!=="string"||!data.name.trim()||(!data.saveOnly&&!data.updateMessage&&!data.channelId)) return jsonError(data.saveOnly?"Укажите название шаблона":"Укажите название и канал");
  // channelId интерполируется в путь Discord REST — только snowflake.
  if(data.channelId&&!isSnowflake(data.channelId))return jsonError("Некорректный канал.");
  if(data.name.trim().length>100)return jsonError("Название шаблона не должно превышать 100 символов.");
  const rawPayload=data.payload as Record<string,unknown>;
  const text=(v:unknown):string|undefined=>typeof v==="string"?v:undefined;
  const fieldsRaw=Array.isArray(rawPayload.fields)?rawPayload.fields.filter((f):f is Record<string,unknown>=>Boolean(f)&&typeof f==="object"):[];
  const enteredFields=fieldsRaw.map(f=>({name:text(f.name)??"",value:text(f.value)??"",inline:Boolean(f.inline)}));
  if(enteredFields.some(f=>Boolean(f.name.trim())!==Boolean(f.value.trim())))return jsonError("Заполните и заголовок, и текст каждого поля или очистите поле полностью.");
  const clean=(value?:string)=>value?.trim()||undefined;
  const footerText=text((rawPayload.footer as {text?:unknown}|undefined)?.text);
  const authorName=text((rawPayload.author as {name?:unknown}|undefined)?.name);
  const thumbUrl=text((rawPayload.thumbnail as {url?:unknown}|undefined)?.url);
  const imageUrl=text((rawPayload.image as {url?:unknown}|undefined)?.url);
  const payload={title:text(rawPayload.title)?.slice(0,256)||undefined,description:text(rawPayload.description)?.slice(0,4096)||undefined,color:Number.isInteger(rawPayload.color)?rawPayload.color as number:5793266,footer:footerText?{text:footerText.slice(0,2048)}:undefined,author:authorName?{name:authorName.slice(0,256),url:clean(text((rawPayload.author as {url?:unknown}|undefined)?.url)),icon_url:clean(text((rawPayload.author as {icon_url?:unknown}|undefined)?.icon_url))}:undefined,thumbnail:thumbUrl?{url:thumbUrl.trim().slice(0,2048)}:undefined,image:imageUrl?{url:imageUrl.trim().slice(0,2048)}:undefined,fields:enteredFields.filter(f=>f.name.trim()&&f.value.trim()).slice(0,25).map(f=>({name:f.name.slice(0,256),value:f.value.slice(0,1024),inline:f.inline}))};
  type EmbedTarget = "author" | "thumbnail" | "image";
  const setAsset=(target:EmbedTarget,url:string)=>{if(target==="author"&&payload.author)payload.author.icon_url=url;if(target==="thumbnail")payload.thumbnail={url};if(target==="image")payload.image={url};};
  let assets: StoredAsset<EmbedTarget>[];
  let originals: { target: EmbedTarget; url: string }[];
  try {
    assets=await collectNewUploads<EmbedTarget>(form,[{formKey:"authorFile",target:"author"},{formKey:"thumbnailFile",target:"thumbnail"},{formKey:"imageFile",target:"image"}],setAsset);
    // Переотправка сохранённых локальных картинок, чтобы правка их не ломала.
    const stored=await reattachStoredAssets<EmbedTarget>({
      targets:["author","image","thumbnail"],
      urlOf:target=>target==="author"?payload.author?.icon_url:target==="image"?payload.image?.url:payload.thumbnail?.url,
      skipTargets:assets.map(asset=>asset.target),
      prefix:embedUploadPrefix(guildId),
      dir:embedUploadsDir(guildId),
      setAsset,
    });
    assets=[...assets,...stored.assets];
    originals=stored.originals;
  } catch (error) {
    if (!(error instanceof AssetError)) throw error;
    return jsonError(error.message);
  }
  const persistAssets=async()=>persistUploadedAssets(embedUploadsDir(guildId),embedUploadPrefix(guildId),assets,originals,setAsset);
  const mode=data.mode==="text"?"text":"embed";
  if(mode==="text"&&(payload.description?.length??0)>2000)return jsonError("Текст сообщения не должен превышать 2000 символов.");
  if(data.saveOnly) {
    await persistAssets();
    const before=data.id?embedByIdStmt.get(data.id,guildId) as {name:string;mode:string;payload_json:string}|undefined:undefined;
    const saved=JSON.stringify(payload), result=data.id
      ? embedSaveUpdateStmt.run(data.name.trim(),saved,mode,data.channelId??"",Date.now(),data.id,guildId)
      : embedSaveInsertStmt.run(guildId,data.name.trim(),saved,data.channelId||null,mode,Date.now());
    // Шаблон мог быть удалён в другой вкладке: не рапортуем успех и не пишем аудит впустую.
    if (data.id && result.changes === 0) return jsonError("Шаблон не найден.", 404);
    after(() => cleanupUnusedDraftImages(guildId));
    if(before) recordDashboardDiff(guildId,user,"Embeds",`Шаблон «${data.name.trim()}»: `,
      {"Название":before.name,"Режим":before.mode==="text"?"текст":"embed",...payloadDisplay(before.payload_json)},
      {"Название":data.name.trim(),"Режим":mode==="text"?"текст":"embed",...payloadDisplay(saved)},
      {"Поля":"изменены"});
    else recordDashboardChange(guildId,user,"Embeds",`Создан шаблон «${data.name.trim()}» (${mode === "text" ? "текст" : "embed"})`);
    return NextResponse.json({ok:true,id:data.id??Number(result.lastInsertRowid)});
  }
  const current=data.id?embedByIdStmt.get(data.id,guildId) as {channel_id:string|null;message_id:string|null;name:string;mode:string;payload_json:string}|undefined:undefined;
  if(data.updateMessage&&(!current?.channel_id||!current.message_id))return jsonError("Сначала отправьте шаблон в канал — обновлять пока нечего.");
  const channelId=data.updateMessage?current!.channel_id!:data.channelId!; const token=process.env.DISCORD_TOKEN; if(!token)return jsonError(BOT_TOKEN_ERROR, 503);
  // allowed_mentions: панель публикует от имени бота — упоминания в тексте
  // не должны пинговать никого (в т.ч. @everyone).
  const bodyData=mode==="text"?{content:payload.description??"",allowed_mentions:{parse:[]}}:{embeds:[payload],allowed_mentions:{parse:[]}}; let body:BodyInit=JSON.stringify(bodyData), headers:Record<string,string>={"content-type":"application/json"};
  if(assets.length) { const multipart=new FormData(); multipart.set("payload_json",JSON.stringify(bodyData)); assets.forEach((asset,i)=>multipart.append(`files[${i}]`,asset.file,asset.filename)); body=multipart; headers={}; }
  const endpoint=`/channels/${channelId}/messages${data.updateMessage?`/${current!.message_id}`:""}`;
  let sent: Response | null = null; try { sent=await discordFetch(endpoint,{method:data.updateMessage?"PATCH":"POST",headers,body}); } catch { /* единый ответ ниже */ }
  if(!sent?.ok)return jsonError(data.updateMessage?"Не удалось обновить опубликованное сообщение":"Не удалось отправить сообщение в выбранный канал", 502); const message=await sent.json() as {id:string};
  await persistAssets();
  const persisted=JSON.stringify(payload);
  // Атомарно: шаблон и история отправки не должны расходиться при сбое между
  // записями (иначе «Отправки» показывают сообщение, которого нет в истории).
  withTransaction(() => {
    const result=data.id
      ? embedPublishUpdateStmt.run(data.name.trim(),persisted,channelId,message.id,mode,Date.now(),data.id,guildId)
      : embedPublishInsertStmt.run(guildId,data.name.trim(),persisted,channelId,message.id,mode,Date.now());
    if(!data.updateMessage){const embedId=data.id??Number(result.lastInsertRowid);sendingInsertStmt.run(guildId,embedId,channelId,message.id,Date.now());}
  });
  after(() => cleanupUnusedDraftImages(guildId));
  if(current) recordDashboardDiff(guildId,user,"Embeds",`Шаблон «${data.name.trim()}» ${data.updateMessage ? "обновлён" : "отправлен заново"}: `,
    {"Название":current.name,"Режим":current.mode==="text"?"текст":"embed","Канал":current.channel_id?`<#${current.channel_id}>`:null,...payloadDisplay(current.payload_json)},
    {"Название":data.name.trim(),"Режим":mode==="text"?"текст":"embed","Канал":`<#${channelId}>`,...payloadDisplay(persisted)},
    {"Поля":"изменены"});
  else recordDashboardChange(guildId,user,"Embeds",`Опубликован шаблон «${data.name.trim()}» в канале <#${channelId}>`);
  return NextResponse.json({ok:true,messageId:message.id});
});

export const DELETE = guildRoute(async (request, { guildId, user }) => {
  const url=new URL(request.url); const sendingId=Number(url.searchParams.get("sendingId")); const id=Number(url.searchParams.get("id"));
  if(Number.isInteger(sendingId)&&sendingId>0){const sending=sendingByIdStmt.get(sendingId,guildId) as {channel_id:string;message_id:string}|undefined;if(!sending)return jsonError("Отправка не найдена.", 404);const token=process.env.DISCORD_TOKEN;if(token){await discordFetch(`/channels/${sending.channel_id}/messages/${sending.message_id}`,{method:"DELETE"}).catch(()=>null);}sendingDeleteStmt.run(sendingId,guildId);recordDashboardChange(guildId,user,"Embeds",`Удалено отправленное сообщение embed в канале <#${sending.channel_id}>`);return NextResponse.json({ok:true});}
  if(!Number.isInteger(id)||id<1)return jsonError("Некорректный идентификатор сообщения.");
  const item=embedByIdStmt.get(id,guildId) as {channel_id:string|null;message_id:string|null;payload_json:string;name:string}|undefined;
  if(!item)return jsonError("Сообщение не найдено.", 404);
  if(item.channel_id&&item.message_id){const token=process.env.DISCORD_TOKEN;if(!token)return jsonError(BOT_TOKEN_ERROR, 503);let result:Response;try{result=await discordFetch(`/channels/${item.channel_id}/messages/${item.message_id}`,{method:"DELETE"});}catch{return jsonError("Не удалось удалить сообщение в Discord.", 502);}if(!result.ok&&result.status!==404)return jsonError("Не удалось удалить сообщение в Discord.", 502);}
  sendingsByEmbedDeleteStmt.run(id,guildId);
  embedDeleteStmt.run(id,guildId);
  after(() => cleanupUnusedDraftImages(guildId));
  recordDashboardChange(guildId, user, "Embeds", `Удалён шаблон «${item.name}»`);
  return NextResponse.json({ok:true});
});