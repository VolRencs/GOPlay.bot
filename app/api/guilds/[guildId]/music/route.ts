import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
import { musicSettingsFor, invalidateMusicSettings, type MusicSettings, type MusicSettingsRow } from "../../../../../src/lib/music-settings.ts";
import { clampMusicSeconds } from "../../../../../src/lib/labels.ts";
import { DEFAULT_MUSIC_LEAVE_SECONDS } from "../../../../../src/lib/constants.ts";
import { recordDashboardDiff } from "../../../../../src/lib/dashboard-audit.ts";
import { AUDIT_SECTION } from "../../../../../src/lib/audit-sections.ts";
import { safeJson } from "../../../../../src/lib/json.ts";
import { musicQueries } from "../../../../../src/db/queries.ts";
import { stmt } from "../../../../../src/db/statements.ts";
import { channelRef, roleRef } from "../../../../../src/lib/mentions.ts";
import { formatLeaveAfter } from "../../../../../src/lib/format.ts";

const readRow = (guildId: string) => stmt.musicSettings.get(guildId) as MusicSettingsRow | undefined;

export const GET = guildRoute(async (_, { guildId }) => {
  return NextResponse.json(musicSettingsFor(guildId));
});

const isValidCommandChannel = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && (value === "" || isSnowflake(value)));

export const PUT = guildRoute(async (request, { guildId, user }) => {
  const body = await readJson<MusicSettings>(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError("Некорректное тело запроса.");
  const current = readRow(guildId);

  const ids = body.voice_channel_ids ?? [];
  const roles = body.allowed_role_ids ?? [];
  // Строка/объект вместо массива раньше молча сбрасывали настройки в [].
  if (!Array.isArray(ids) || !Array.isArray(roles)) return jsonError("Некорректный список каналов или ролей.");
  if (!ids.every(id => isSnowflake(id)) || !roles.every(role => isSnowflake(role)))
    return jsonError("Некорректный ID канала или роли.");
  if (new Set(ids).size !== ids.length)
    return jsonError("Голосовые каналы повторяются.");
  const currentPlaylistRoles = current ? safeJson<string[]>(current.playlist_role_ids_json, []) : [];
  const playlistRoles = body.playlist_role_ids ?? currentPlaylistRoles;
  if (!Array.isArray(playlistRoles) || !playlistRoles.every(role => isSnowflake(role)))
    return jsonError("Некорректный ID роли для плейлистов.");
  const playlistsEnabled = body.playlists_enabled === undefined
    ? (current ? current.playlists_enabled !== 0 : true)
    : body.playlists_enabled;
  if (typeof playlistsEnabled !== "boolean") return jsonError("Некорректная настройка плейлистов.");

  const secondsRaw = Number(body.leave_after_seconds ?? DEFAULT_MUSIC_LEAVE_SECONDS);
  if (!Number.isInteger(secondsRaw)) return jsonError("Некорректный таймаут.");
  const leaveAfterSeconds = clampMusicSeconds(secondsRaw);

  // Пусто/не задано — сброс привязки; мусор вместо snowflake — 400, а не тихий null.
  if (!isValidCommandChannel(body.command_channel_id ?? null))
    return jsonError("Некорректный ID канала.");
  const commandChannelId = body.command_channel_id ? body.command_channel_id : null;

  const next = {
    command_channel_id: commandChannelId,
    voice_channel_ids_json: JSON.stringify([...new Set(ids)]),
    allowed_role_ids_json: JSON.stringify([...new Set(roles)]),
    leave_after_seconds: leaveAfterSeconds,
    playlists_enabled: +playlistsEnabled,
    playlist_role_ids_json: JSON.stringify([...new Set(playlistRoles)]),
  };
  if (
    current && current.command_channel_id === next.command_channel_id &&
    current.voice_channel_ids_json === next.voice_channel_ids_json &&
    current.allowed_role_ids_json === next.allowed_role_ids_json &&
    current.leave_after_seconds === next.leave_after_seconds &&
    current.playlists_enabled === next.playlists_enabled &&
    current.playlist_role_ids_json === next.playlist_role_ids_json
  ) return NextResponse.json({ ok: true, unchanged: true });

  musicQueries.upsert.run(guildId, next.command_channel_id, next.voice_channel_ids_json, next.allowed_role_ids_json, next.leave_after_seconds, next.playlists_enabled, next.playlist_role_ids_json);
  invalidateMusicSettings(guildId);

  recordDashboardDiff(guildId, user, AUDIT_SECTION.music, "Настройки музыки: ",
    {
      "Канал команд": current?.command_channel_id ? channelRef(current.command_channel_id) : null,
      "Голосовые каналы": current ? safeJson<string[]>(current.voice_channel_ids_json, []).map(channelRef) : [],
      "Разрешённые роли": current ? safeJson<string[]>(current.allowed_role_ids_json, []).map(roleRef) : [],
      "Плейлисты": current ? current.playlists_enabled !== 0 : true,
      "Роли плейлистов": current ? safeJson<string[]>(current.playlist_role_ids_json, []).map(roleRef) : [],
      "Автовыход": current ? formatLeaveAfter(current.leave_after_seconds) : null,
    },
    {
      "Канал команд": next.command_channel_id ? channelRef(next.command_channel_id) : null,
      "Голосовые каналы": ids.map(channelRef),
      "Разрешённые роли": roles.map(roleRef),
      "Плейлисты": playlistsEnabled,
      "Роли плейлистов": [...new Set(playlistRoles)].map(roleRef),
      "Автовыход": formatLeaveAfter(leaveAfterSeconds),
    });
  return NextResponse.json({ ok: true });
});
