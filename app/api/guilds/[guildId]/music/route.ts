import { NextResponse } from "next/server.js";
import { isSnowflake, withGuild } from "../../../../../src/lib/guild-access.ts";
import { musicSettingsFor } from "../../../../../src/lib/music-settings.ts";
import { clampMusicSeconds } from "../../../../../src/lib/labels.ts";
import { recordDashboardChange } from "../../../../../src/lib/dashboard-audit.ts";
import { db } from "../../../../../src/db/database.ts";
import type { MusicPutBody } from "../../../../../src/components/dashboard/types.ts";

const readRow = (guildId: string) => db.prepare("SELECT command_channel_id,voice_channel_ids_json,allowed_role_ids_json,leave_after_seconds FROM music_settings WHERE guild_id=?").get(guildId) as
  | { command_channel_id: string | null; voice_channel_ids_json: string; allowed_role_ids_json: string; leave_after_seconds: number }
  | undefined;

export async function GET(_: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await withGuild(guildId);
  if (access instanceof Response) return access;
  return NextResponse.json(musicSettingsFor(guildId));
}

const isValidCommandChannel = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && (value === "" || isSnowflake(value)));

export async function PUT(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await withGuild(guildId);
  if (access instanceof Response) return access;

  const body = await request.json().catch(() => null) as MusicPutBody | null;
  if (!body) return NextResponse.json({ error: "Некорректное тело запроса." }, { status: 400 });

  // Валидация: snowflake-формат для всех id; 0 = автовыход выключен,
  const ids = Array.isArray(body.voice_channel_ids) ? body.voice_channel_ids : [];
  const roles = Array.isArray(body.allowed_role_ids) ? body.allowed_role_ids : [];
  if (!ids.every(id => isSnowflake(id)) || !roles.every(role => isSnowflake(role)))
    return NextResponse.json({ error: "Некорректный ID канала или роли." }, { status: 400 });
  if (new Set(ids).size !== ids.length)
    return NextResponse.json({ error: "Голосовые каналы повторяются." }, { status: 400 });

  const secondsRaw = Number(body.leave_after_seconds ?? 300);
  if (!Number.isInteger(secondsRaw)) return NextResponse.json({ error: "Некорректный таймаут." }, { status: 400 });
  const leaveAfterSeconds = clampMusicSeconds(secondsRaw);

  // Пусто/не задано — сброс привязки; мусор вместо snowflake — 400, а не тихий null.
  if (!isValidCommandChannel(body.command_channel_id ?? null))
    return NextResponse.json({ error: "Некорректный ID канала." }, { status: 400 });
  const commandChannelId = body.command_channel_id ? body.command_channel_id : null;

  const current = readRow(guildId);
  const next = {
    command_channel_id: commandChannelId,
    voice_channel_ids_json: JSON.stringify([...new Set(ids)]),
    allowed_role_ids_json: JSON.stringify([...new Set(roles)]),
    leave_after_seconds: leaveAfterSeconds,
  };
  if (
    current && current.command_channel_id === next.command_channel_id &&
    current.voice_channel_ids_json === next.voice_channel_ids_json &&
    current.allowed_role_ids_json === next.allowed_role_ids_json &&
    current.leave_after_seconds === next.leave_after_seconds
  ) return NextResponse.json({ ok: true, unchanged: true });

  db.prepare(
    "INSERT INTO music_settings(guild_id,command_channel_id,voice_channel_ids_json,allowed_role_ids_json,leave_after_seconds) VALUES(?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET command_channel_id=excluded.command_channel_id,voice_channel_ids_json=excluded.voice_channel_ids_json,allowed_role_ids_json=excluded.allowed_role_ids_json,leave_after_seconds=excluded.leave_after_seconds",
  ).run(guildId, next.command_channel_id, next.voice_channel_ids_json, next.allowed_role_ids_json, next.leave_after_seconds);

  recordDashboardChange(guildId, access.user, "Музыка", `Настройки музыки обновлены.`);
  return NextResponse.json({ ok: true });
}
