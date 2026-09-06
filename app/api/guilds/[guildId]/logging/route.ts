import { NextResponse } from "next/server.js";
import { isSnowflake, withGuild } from "../../../../../src/lib/guild-access.ts";
import { db } from "../../../../../src/db/database.ts";
import { safeJson, stableJson } from "../../../../../src/lib/json.ts";
import { logKeys } from "../../../../../src/lib/labels.ts";
import { stmt } from "../../../../../src/bot/db/statements.ts";
import { recordDashboardChange } from "../../../../../src/lib/dashboard-audit.ts";

const defaults: Record<string, boolean> = Object.fromEntries(logKeys.map(key => [key, true]));

export async function GET(_:Request,{params}:{params:Promise<{guildId:string}>}) {
  const {guildId}=await params, access=await withGuild(guildId);
  if(access instanceof Response)return access;
  const saved=stmt.loggingSettings.get(guildId) as {channel_id:string|null;categories_json:string}|undefined;
  const categories={...defaults,...safeJson<Record<string,boolean>>(saved?.categories_json,{})};
  return NextResponse.json({channel_id:saved?.channel_id??null,categories_json:JSON.stringify(categories)});
}

export async function PUT(request:Request,{params}:{params:Promise<{guildId:string}>}) {
  const {guildId}=await params, access=await withGuild(guildId);
  if(access instanceof Response)return access;
  const body=await request.json().catch(()=>null) as {channelId:string|null;categories?:Record<string,unknown>}|null;
  // Snowflake-валидация: опечатка иначе молча отключила бы доставку логов —
  // бот не разрешил бы канал и терял записи без ошибок.
  if(!body||(body.channelId!==null&&(!isSnowflake(body.channelId))))return NextResponse.json({error:"Некорректный канал"},{status:400});
  const categories=Object.fromEntries(logKeys.map(key=>[key,Boolean(body.categories?.[key])]));
  const saved=stmt.loggingSettings.get(guildId) as {channel_id:string|null;categories_json:string}|undefined;
  const storedCategories=safeJson<Record<string,boolean>>(saved?.categories_json,{});
  const next=stableJson({channel:body.channelId,categories});
  const current=saved?stableJson({channel:saved.channel_id??null,categories:Object.fromEntries(logKeys.map(key=>[key,Boolean(storedCategories[key])]))}):null;
  if(current===next)return NextResponse.json({ok:true,unchanged:true});
  db.prepare("INSERT INTO logging_settings(guild_id,channel_id,categories_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id,categories_json=excluded.categories_json,updated_at=excluded.updated_at").run(guildId,body.channelId,JSON.stringify(categories),Date.now());
  const enabledCount=Object.values(categories).filter(Boolean).length;
  recordDashboardChange(guildId,access.user,"Логи",`Журнал событий: ${body.channelId ? "канал выбран" : "канал не выбран"} · включено категорий: ${enabledCount}`);
  return NextResponse.json({ok:true});
}
