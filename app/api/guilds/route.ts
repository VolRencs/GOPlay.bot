import { NextResponse } from "next/server.js";
import { DiscordRateLimitError, canManageGuild, discordGuilds, requireUser, jsonError } from "../../../src/lib/guild-access.ts";
import { db } from "../../../src/db/database.ts";
import { logger } from "../../../src/bot/utils/logger.ts";
import type { GuildListGet } from "../../../src/components/dashboard/types.ts";

export async function GET() {
  const gate = await requireUser();
  if (!gate.ok) return jsonError(gate.error, gate.status);

  try {
    const allowed = (await discordGuilds(gate.requestHeaders, gate.discordAccount?.id)).filter(canManageGuild);
    if (!allowed.length) return NextResponse.json([]);
    const marks = allowed.map(() => "?").join(","), configured = new Set((db.prepare(`SELECT id FROM guilds WHERE id IN (${marks})`).all(...allowed.map(guild=>guild.id)) as {id:string}[]).map(row=>row.id));
    return NextResponse.json<GuildListGet>(allowed.filter(guild=>configured.has(guild.id)).sort((a,b)=>a.name.localeCompare(b.name)).map(({id,name,icon})=>({id,name,icon})));
  } catch (error) {
    logger.warn("[WARN] Discord guild list failed", error);
    if (error instanceof DiscordRateLimitError) return NextResponse.json({ error: "Discord временно ограничил запросы. Подождите несколько секунд и обновите страницу.", reauth: false }, { status: 429, headers: { "Retry-After": String(Math.ceil(error.retryAfterMs / 1000)) } });
    const authFailed = Error.isError(error) && /\(401\)/.test(error.message);
    return NextResponse.json({ error: authFailed ? "Сессия Discord истекла. Войдите через Discord снова." : "Не удалось получить список серверов от Discord. Обновите страницу.", reauth: authFailed }, { status: authFailed ? 403 : 502 });
  }
}
