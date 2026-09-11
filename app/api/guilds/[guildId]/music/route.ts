import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
import { musicSettingsFor } from "../../../../../src/lib/music-settings.ts";
import { clampMusicSeconds } from "../../../../../src/lib/labels.ts";
import { recordDashboardDiff } from "../../../../../src/lib/dashboard-audit.ts";
import { safeJson } from "../../../../../src/lib/json.ts";
import { db } from "../../../../../src/db/database.ts";
import { stmt } from "../../../../../src/bot/db/statements.ts";
import type { MusicPutBody } from "../../../../../src/components/dashboard/types.ts";

const channelRef = (id: string) => `<#${id}>`;
const roleRef = (id: string) => `<@&${id}>`;
const leaveLabel = (seconds: number) => seconds === 0 ? "выключен" : seconds % 60 === 0 ? `${seconds / 60} мин` : `${seconds} с`;

const musicUpsertStmt = db.prepare(
  "INSERT INTO music_settings(guild_id,command_channel_id,voice_channel_ids_json,allowed_role_ids_json,leave_after_seconds) VALUES(?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET command_channel_id=excluded.command_channel_id,voice_channel_ids_json=excluded.voice_channel_ids_json,allowed_role_ids_json=excluded.allowed_role_ids_json,leave_after_seconds=excluded.leave_after_seconds",
);
const readRow = (guildId: string) => stmt.musicSettings.get(guildId) as
  | { command_channel_id: string | null; voice_channel_ids_json: string; allowed_role_ids_json: string; leave_after_seconds: number }
  | undefined;

export const GET = guildRoute(async (_, { guildId }) => {
  return NextResponse.json(musicSettingsFor(guildId));
});

const isValidCommandChannel = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && (value === "" || isSnowflake(value)));

export const PUT = guildRoute(async (request, { guildId, user }) => {
  const body = await readJson<MusicPutBody>(request);
  if (!body) return jsonError("Некорректное тело запроса.");

  // Валидация: snowflake-формат для всех id; 0 = автовыход выключен,
  const ids = Array.isArray(body.voice_channel_ids) ? body.voice_channel_ids : [];
  const roles = Array.isArray(body.allowed_role_ids) ? body.allowed_role_ids : [];
  if (!ids.every(id => isSnowflake(id)) || !roles.every(role => isSnowflake(role)))
    return jsonError("Некорректный ID канала или роли.");
  if (new Set(ids).size !== ids.length)
    return jsonError("Голосовые каналы повторяются.");

  const secondsRaw = Number(body.leave_after_seconds ?? 300);
  if (!Number.isInteger(secondsRaw)) return jsonError("Некорректный таймаут.");
  const leaveAfterSeconds = clampMusicSeconds(secondsRaw);

  // Пусто/не задано — сброс привязки; мусор вместо snowflake — 400, а не тихий null.
  if (!isValidCommandChannel(body.command_channel_id ?? null))
    return jsonError("Некорректный ID канала.");
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

  musicUpsertStmt.run(guildId, next.command_channel_id, next.voice_channel_ids_json, next.allowed_role_ids_json, next.leave_after_seconds);

  recordDashboardDiff(guildId, user, "Музыка", "Настройки музыки: ",
    {
      "Канал команд": current?.command_channel_id ? channelRef(current.command_channel_id) : null,
      "Голосовые каналы": current ? safeJson<string[]>(current.voice_channel_ids_json, []).map(channelRef) : [],
      "Разрешённые роли": current ? safeJson<string[]>(current.allowed_role_ids_json, []).map(roleRef) : [],
      "Автовыход": current ? leaveLabel(current.leave_after_seconds) : null,
    },
    {
      "Канал команд": next.command_channel_id ? channelRef(next.command_channel_id) : null,
      "Голосовые каналы": ids.map(channelRef),
      "Разрешённые роли": roles.map(roleRef),
      "Автовыход": leaveLabel(leaveAfterSeconds),
    });
  return NextResponse.json({ ok: true });
});
