import { NextResponse } from "next/server.js";
import { isSnowflake, withGuild } from "../../../../../src/lib/guild-access.ts";
import { musicSettingsFor } from "../../../../../src/lib/music-settings.ts";
import { recordDashboardChange } from "../../../../../src/lib/dashboard-audit.ts";
import { db } from "../../../../../src/db/database.ts";

type MusicPayload = {
  command_channel_id?: string | null;
  voice_channel_ids?: string[];
  allowed_role_ids?: string[];
  leave_after_seconds?: number;
};

const readRow = (guildId: string) => db.prepare("SELECT * FROM music_settings WHERE guild_id=?").get(guildId) as
  | { command_channel_id: string | null; voice_channel_ids_json: string; allowed_role_ids_json: string; leave_after_seconds: number }
  | undefined;

export async function GET(_: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await withGuild(guildId);
  if (access instanceof Response) return access;
  return NextResponse.json(musicSettingsFor(guildId));
}

const validIdOrNull = (value: unknown): string | null =>
  typeof value === "string" && (value === "" || isSnowflake(value)) ? value || null : null;

export async function PUT(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await withGuild(guildId);
  if (access instanceof Response) return access;

  const body = await request.json().catch(() => null) as MusicPayload | null;
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
  const leaveAfterSeconds = secondsRaw === 0 ? 0 : Math.max(30, Math.min(3600, secondsRaw));

  const commandChannelId = validIdOrNull(body.command_channel_id ?? null);

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
