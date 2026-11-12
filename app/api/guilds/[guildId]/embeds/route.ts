import { after, NextResponse } from "next/server.js";
import { DiscordRateLimitError, discordFetch, guildRoute, isSnowflake, jsonError, readFormDataJson, requireBotToken } from "#lib/guild-access.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { withTransaction } from "#db/database.ts";
import { deleteEmbedSendings, embedsQueries } from "#db/queries.ts";
import { stmt } from "#db/statements.ts";
import { safeJson, stableJson } from "#lib/json.ts";
import { recordDashboardChange, recordDashboardDiff } from "#lib/dashboard-audit.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";
import { channelRef } from "#lib/format.ts";
import { cleanupUnusedUploads, embedUploadPrefix, embedUploadsDir, extractFilenames, rejectOversized } from "#lib/uploads.ts";
import { logger } from "#lib/logger.ts";
import { BRAND_COLOR, colorNumberToHex } from "#lib/colors.ts";
import { AssetError, collectFormAssets, discordMessageBody, persistUploadedAssets, type UploadAssetSet } from "#lib/assets.ts";
import { embedCharacterCount, EMBED_LIMITS, normalizeEmbedContent, sendingToDto, toDiscordEmbed, toDto as toEmbedDto, type EmbedContent, type EmbedsGetDto } from "#contracts/embeds.ts";
import { CHANNEL_TYPES, resourceError, validateResources } from "#lib/guild-resources.ts";

type RequestData = { id?: number; saveOnly?: boolean; updateMessage?: boolean; name: string; channelId?: string; mode?: "embed" | "text"; payload: EmbedContent };

function draftImageNames(payloadJson:string,guildId:string) {
  const payload=safeJson<{author?:{iconUrl?:string};thumbnail?:{url?:string};image?:{url?:string}}>(payloadJson,{});
  return extractFilenames(embedUploadPrefix(guildId), [payload.author?.iconUrl, payload.thumbnail?.url, payload.image?.url]);
}

async function cleanupUnusedDraftImages(guildId:string) {
  await cleanupUnusedUploads(embedUploadsDir(guildId), embedsQueries.payloads.all(guildId), row => draftImageNames(row.payload_json, guildId), 60 * 60_000);
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
    "Цвет": typeof p.color === "number" ? colorNumberToHex(p.color) : null,
    "Футер": typeof footer?.text === "string" ? footer.text : null,
    "Автор": typeof author?.name === "string" ? author.name : null,
    "Изображение": typeof image?.url === "string" ? image.url : null,
    "Миниатюра": typeof thumbnail?.url === "string" ? thumbnail.url : null,
    "Поля": stableJson(fields),
  };
}

function embedsDto(guildId: string): EmbedsGetDto {
  return { embeds: embedsQueries.list.all(guildId).map(toEmbedDto), sendings: embedsQueries.sendings.all(guildId).map(sendingToDto) };
}

async function verifySendings(guildId: string): Promise<EmbedsGetDto> {
  let sendings = embedsQueries.sendings.all(guildId);
  if (sendings.length > 0) {
    const stale: typeof sendings = [];
    const CONCURRENCY = 5;
    for (let i = 0; i < sendings.length; i += CONCURRENCY) {
      const chunk = sendings.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(chunk.map(async (sending) => {
        try {
          const response = await discordFetch(`/channels/${sending.channel_id}/messages/${sending.message_id}`, { signal: AbortSignal.timeout(5000) });
          return response.status === 404 ? sending : null;
        } catch (error) {
          if (error instanceof DiscordRateLimitError) logger.warn("[EMBEDS] Discord rate limit", guildId, error.retryAfterMs);
          return null;
        }
      }));
      for (const result of results) if (result.status === "fulfilled" && result.value) stale.push(result.value);
      if (i + CONCURRENCY < sendings.length) await sleep(210);
    }
    if (stale.length > 0) {
      withTransaction(() => {
        for (const sending of stale) stmt.embedDetach.run(Date.now(), guildId, sending.channel_id, sending.message_id);
        deleteEmbedSendings(guildId, stale.map(sending => sending.id));
      });
      const staleIds = new Set(stale.map(sending => sending.id));
      sendings = sendings.filter(sending => !staleIds.has(sending.id));
    }
  }
  return { embeds: embedsQueries.list.all(guildId).map(toEmbedDto), sendings: sendings.map(sendingToDto) };
}

export const GET = guildRoute(async (_request, { guildId }) => {
  return NextResponse.json<EmbedsGetDto>(embedsDto(guildId));
});

export const PATCH = guildRoute(async (_request, { guildId }) => {
  const tokenError = requireBotToken();
  if (tokenError) return tokenError;
  return NextResponse.json<EmbedsGetDto>(await verifySendings(guildId));
});

export const POST = guildRoute(async (request, { guildId, user }) => {
  const oversized=rejectOversized(request); if(oversized) return oversized;
  const parsedBody=await readFormDataJson<RequestData>(request);
  if(!parsedBody)return jsonError("Не удалось прочитать данные сообщения. Попробуйте выбрать изображение заново.");
  const { form, data } = parsedBody;
  if(!data||typeof data!=="object")return jsonError("Некорректные данные сообщения.");
  if(!data.payload||typeof data.payload!=="object"||Array.isArray(data.payload))return jsonError("Некорректные данные сообщения.");
  if(data.id!==undefined&&(!Number.isInteger(data.id)||data.id<1))return jsonError("Некорректный идентификатор шаблона.");
  if(typeof data.name!=="string"||!data.name.trim()||(!data.saveOnly&&!data.updateMessage&&!data.channelId)) return jsonError(data.saveOnly?"Укажите название шаблона":"Укажите название и канал");
  if(data.channelId&&!isSnowflake(data.channelId))return jsonError("Некорректный канал.");
  if(data.name.trim().length>100)return jsonError("Название шаблона не должно превышать 100 символов.");
  const normalized=normalizeEmbedContent(data.payload);
  if(normalized.halfFilled)return jsonError("Заполните и заголовок, и текст каждого поля или очистите поле полностью.");
  const payload: EmbedContent={...normalized.content,color:normalized.content.color??BRAND_COLOR};
  if(embedCharacterCount(payload)>EMBED_LIMITS.total)return jsonError("Сообщение слишком большое для Discord: сократите текст или количество полей.");
  type EmbedTarget = "author" | "thumbnail" | "image";
  const setAsset=(target:EmbedTarget,url:string)=>{if(target==="author"&&payload.author)payload.author.iconUrl=url;if(target==="thumbnail")payload.thumbnail={url};if(target==="image")payload.image={url};};
  let uploads: UploadAssetSet<EmbedTarget>;
  try {
    uploads=await collectFormAssets<EmbedTarget>({
      form,
      specs:[{formKey:"authorFile",target:"author"},{formKey:"thumbnailFile",target:"thumbnail"},{formKey:"imageFile",target:"image"}],
      targets:["author","image","thumbnail"],
      urlOf:target=>target==="author"?payload.author?.iconUrl:target==="image"?payload.image?.url:payload.thumbnail?.url,
      prefix:embedUploadPrefix(guildId),
      dir:embedUploadsDir(guildId),
      setAsset,
    });
  } catch (error) {
    if (!(error instanceof AssetError)) throw error;
    return jsonError(error.message);
  }
  const { assets, originals } = uploads;
  const persistAssets=async()=>persistUploadedAssets(embedUploadsDir(guildId),embedUploadPrefix(guildId),assets,originals,setAsset);
  const mode=data.mode==="text"?"text":"embed";
  if(mode==="text"&&(payload.description?.length??0)>2000)return jsonError("Текст сообщения не должен превышать 2000 символов.");
  if(data.saveOnly) {
    if (data.channelId) {
      const channelCheck = await validateResources(guildId, { channels: { ids: [data.channelId], types: CHANNEL_TYPES.text } });
      if (!channelCheck.ok) return resourceError(channelCheck);
    }
    await persistAssets();
    const before=data.id?embedsQueries.byId.get(data.id,guildId):undefined;
    const saved=JSON.stringify(payload), result=data.id
      ? embedsQueries.saveUpdate.run(data.name.trim(),saved,mode,data.channelId??"",Date.now(),data.id,guildId)
      : embedsQueries.saveInsert.run(guildId,data.name.trim(),saved,data.channelId||null,mode,Date.now());
    if (data.id && result.changes === 0) return jsonError("Шаблон не найден.", 404);
    after(() => cleanupUnusedDraftImages(guildId));
    if(before) recordDashboardDiff(guildId,user,AUDIT_SECTION.embeds,`Шаблон «${data.name.trim()}»: `,
      {"Название":before.name,"Режим":before.mode==="text"?"текст":"embed",...payloadDisplay(before.payload_json)},
      {"Название":data.name.trim(),"Режим":mode==="text"?"текст":"embed",...payloadDisplay(saved)},
      {"Поля":"изменены"});
    else recordDashboardChange(guildId,user,AUDIT_SECTION.embeds,`Создан шаблон «${data.name.trim()}» (${mode === "text" ? "текст" : "embed"})`);
    return NextResponse.json({ok:true,id:data.id??Number(result.lastInsertRowid)});
  }
  const current=data.id?embedsQueries.byId.get(data.id,guildId):undefined;
  if(data.updateMessage&&(!current?.channel_id||!current.message_id))return jsonError("Сначала отправьте шаблон в канал — обновлять пока нечего.");
  const channelId=data.updateMessage?current!.channel_id!:data.channelId!; const tokenError=requireBotToken(); if(tokenError)return tokenError;
  const channelCheck = await validateResources(guildId, { channels: { ids: [channelId], types: CHANNEL_TYPES.text } });
  if (!channelCheck.ok) return resourceError(channelCheck);
  const discordPayload=toDiscordEmbed(payload);
  const bodyData=mode==="text"?{content:payload.description??"",allowed_mentions:{parse:[]}}:{embeds:[discordPayload],allowed_mentions:{parse:[]}}; const { body, headers } = discordMessageBody(bodyData, assets);
  const endpoint=`/channels/${channelId}/messages${data.updateMessage?`/${current!.message_id}`:""}`;
  let sent: Response | null = null; try { sent=await discordFetch(endpoint,{method:data.updateMessage?"PATCH":"POST",headers,body}); } catch {  }
  if(!sent?.ok)return jsonError(data.updateMessage?"Не удалось обновить опубликованное сообщение":"Не удалось отправить сообщение в выбранный канал", 502); const message=await sent.json() as {id:string};
  await persistAssets();
  const persisted=JSON.stringify(payload);
  withTransaction(() => {
    const result=data.id
      ? embedsQueries.publishUpdate.run(data.name.trim(),persisted,channelId,message.id,mode,Date.now(),data.id,guildId)
      : embedsQueries.publishInsert.run(guildId,data.name.trim(),persisted,channelId,message.id,mode,Date.now());
    if(!data.updateMessage){const embedId=data.id??Number(result.lastInsertRowid);embedsQueries.sendingInsert.run(guildId,embedId,channelId,message.id,Date.now());}
  });
  after(() => cleanupUnusedDraftImages(guildId));
  if(current) recordDashboardDiff(guildId,user,AUDIT_SECTION.embeds,`Шаблон «${data.name.trim()}» ${data.updateMessage ? "обновлён" : "отправлен заново"}: `,
    {"Название":current.name,"Режим":current.mode==="text"?"текст":"embed","Канал":current.channel_id?channelRef(current.channel_id):null,...payloadDisplay(current.payload_json)},
    {"Название":data.name.trim(),"Режим":mode==="text"?"текст":"embed","Канал":channelRef(channelId),...payloadDisplay(persisted)},
    {"Поля":"изменены"});
  else recordDashboardChange(guildId,user,AUDIT_SECTION.embeds,`Опубликован шаблон «${data.name.trim()}» в канале ${channelRef(channelId)}`);
  return NextResponse.json({ok:true,messageId:message.id});
});

export const DELETE = guildRoute(async (request, { guildId, user }) => {
  const url=new URL(request.url); const sendingId=Number(url.searchParams.get("sendingId")); const id=Number(url.searchParams.get("id"));
  if (Number.isInteger(sendingId) && sendingId > 0) {
    const sending = embedsQueries.sendingById.get(sendingId, guildId);
    if (!sending) return jsonError("Отправка не найдена.", 404);
    const tokenError = requireBotToken();
    if (tokenError) return tokenError;
    let result: Response;
    try {
      result = await discordFetch(`/channels/${sending.channel_id}/messages/${sending.message_id}`, { method: "DELETE" });
    } catch {
      return jsonError("Не удалось удалить сообщение в Discord.", 502);
    }
    if (!result.ok && result.status !== 404) return jsonError("Не удалось удалить сообщение в Discord.", 502);
    embedsQueries.sendingDelete.run(sendingId, guildId);
    recordDashboardChange(guildId, user, AUDIT_SECTION.embeds, `Удалено отправленное сообщение embed в канале ${channelRef(sending.channel_id)}`);
    return NextResponse.json({ ok: true });
  }
  if(!Number.isInteger(id)||id<1)return jsonError("Некорректный идентификатор сообщения.");
  const item=embedsQueries.byId.get(id,guildId);
  if(!item)return jsonError("Сообщение не найдено.", 404);
  if(item.channel_id&&item.message_id){const tokenError=requireBotToken();if(tokenError)return tokenError;let result:Response;try{result=await discordFetch(`/channels/${item.channel_id}/messages/${item.message_id}`,{method:"DELETE"});}catch{return jsonError("Не удалось удалить сообщение в Discord.", 502);}if(!result.ok&&result.status!==404)return jsonError("Не удалось удалить сообщение в Discord.", 502);}
  embedsQueries.sendingsByEmbedDelete.run(id,guildId);
  embedsQueries.delete.run(id,guildId);
  after(() => cleanupUnusedDraftImages(guildId));
  recordDashboardChange(guildId, user, AUDIT_SECTION.embeds, `Удалён шаблон «${item.name}»`);
  return NextResponse.json({ok:true});
});
