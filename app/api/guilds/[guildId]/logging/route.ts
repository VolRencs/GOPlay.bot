import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
import { db } from "../../../../../src/db/database.ts";
import { safeJson, stableJson } from "../../../../../src/lib/json.ts";
import { logGroups, logKeys, type LoggingGet, type LoggingPutBody } from "../../../../../src/lib/labels.ts";
import { stmt } from "../../../../../src/bot/db/statements.ts";
import { recordDashboardDiff } from "../../../../../src/lib/dashboard-audit.ts";

const defaults: Record<string, boolean> = Object.fromEntries(logKeys.map(key => [key, true]));
const categoryTitles: Record<string, string> = Object.fromEntries(logGroups.flatMap(group => group.items.map(([key, , title]) => [key, title])));
const loggingUpsert = db.prepare("INSERT INTO logging_settings(guild_id,channel_id,categories_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id,categories_json=excluded.categories_json,updated_at=excluded.updated_at");

export const GET = guildRoute(async (_, { guildId }) => {
  const saved=stmt.loggingSettings.get(guildId) as {channel_id:string|null;categories_json:string}|undefined;
  const categories={...defaults,...safeJson<Record<string,boolean>>(saved?.categories_json,{})};
  return NextResponse.json<LoggingGet>({channel_id:saved?.channel_id??null,categories_json:JSON.stringify(categories)});
});

export const PUT = guildRoute(async (request, { guildId, user }) => {
  const body=await readJson<LoggingPutBody>(request);
  // Snowflake-валидация: опечатка иначе молча отключила бы доставку логов —
  // бот не разрешил бы канал и терял записи без ошибок.
  if(!body||(body.channelId!==null&&(!isSnowflake(body.channelId))))return jsonError("Некорректный канал");
  const categories=Object.fromEntries(logKeys.map(key=>[key,Boolean(body.categories?.[key])]));
  const saved=stmt.loggingSettings.get(guildId) as {channel_id:string|null;categories_json:string}|undefined;
  const storedCategories=safeJson<Record<string,boolean>>(saved?.categories_json,{});
  const next=stableJson({channel:body.channelId,categories});
  const current=saved?stableJson({channel:saved.channel_id??null,categories:Object.fromEntries(logKeys.map(key=>[key,Boolean(storedCategories[key])]))}):null;
  if(current===next)return NextResponse.json({ok:true,unchanged:true});
  loggingUpsert.run(guildId,body.channelId,JSON.stringify(categories),Date.now());
  recordDashboardDiff(guildId, user, "Логи", "Журнал событий: ",
    {
      "Канал": saved?.channel_id ? `<#${saved.channel_id}>` : null,
      "Включённые категории": logKeys.filter(key => Boolean(storedCategories[key])).map(key => categoryTitles[key]!),
    },
    {
      "Канал": body.channelId ? `<#${body.channelId}>` : null,
      "Включённые категории": logKeys.filter(key => categories[key]).map(key => categoryTitles[key]!),
    });
  return NextResponse.json({ok:true});
});
