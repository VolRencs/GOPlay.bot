import { isSnowflake, jsonError } from "#lib/guild-access.ts";
import { musicSettingsFor, invalidateMusicSettings } from "#lib/music-settings.ts";
import { clampMusicSeconds } from "#lib/labels.ts";
import { DEFAULT_MUSIC_LEAVE_SECONDS } from "#lib/constants.ts";
import { musicQueries } from "#db/queries.ts";
import { settingsGetRoute, settingsPutRoute } from "#lib/settings-route.ts";
import { musicState, musicView } from "#lib/settings-views.ts";
import { fromDto as fromMusicDto, toDto as toMusicDto, type MusicDto } from "#contracts/music.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";
import { CHANNEL_TYPES, resourceError, validateResources } from "#lib/guild-resources.ts";

const isValidCommandChannel = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && (value === "" || isSnowflake(value)));

export const GET = settingsGetRoute(guildId => toMusicDto(musicSettingsFor(guildId)));

export const PUT = settingsPutRoute<MusicDto>({
  load: guildId => musicState(guildId),
  parse: (body, _guildId, current) => {
    const value = body as Partial<MusicDto> | null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, response: jsonError("Некорректное тело запроса.") };

    const ids = value.voiceChannelIds ?? [];
    const roles = value.allowedRoleIds ?? [];
    if (!Array.isArray(ids) || !Array.isArray(roles)) return { ok: false, response: jsonError("Некорректный список каналов или ролей.") };
    if (!ids.every(id => isSnowflake(id)) || !roles.every(role => isSnowflake(role))) return { ok: false, response: jsonError("Некорректный ID канала или роли.") };
    if (new Set(ids).size !== ids.length) return { ok: false, response: jsonError("Голосовые каналы повторяются.") };
    const playlistRoles = value.playlistRoleIds ?? current.playlistRoleIds;
    if (!Array.isArray(playlistRoles) || !playlistRoles.every(role => isSnowflake(role))) return { ok: false, response: jsonError("Некорректный ID роли для плейлистов.") };
    const playlistsEnabled = value.playlistsEnabled === undefined ? current.playlistsEnabled : value.playlistsEnabled;
    if (typeof playlistsEnabled !== "boolean") return { ok: false, response: jsonError("Некорректная настройка плейлистов.") };

    const secondsRaw = Number(value.leaveAfterSeconds ?? DEFAULT_MUSIC_LEAVE_SECONDS);
    if (!Number.isInteger(secondsRaw)) return { ok: false, response: jsonError("Некорректный таймаут.") };
    const leaveAfterSeconds = clampMusicSeconds(secondsRaw);

    if (!isValidCommandChannel(value.commandChannelId ?? null)) return { ok: false, response: jsonError("Некорректный ID канала.") };
    const commandChannelId = value.commandChannelId ? value.commandChannelId : null;

    return {
      ok: true,
      value: {
        commandChannelId,
        voiceChannelIds: [...new Set(ids)],
        allowedRoleIds: [...new Set(roles)],
        leaveAfterSeconds,
        playlistsEnabled,
        playlistRoleIds: [...new Set(playlistRoles)],
      },
    };
  },
  validate: async (guildId, value) => {
    const channels = await validateResources(guildId, {
      channels: { ids: [value.commandChannelId], types: CHANNEL_TYPES.text },
    });
    if (!channels.ok) return resourceError(channels);
    const voice = await validateResources(guildId, {
      channels: { ids: value.voiceChannelIds, types: CHANNEL_TYPES.voice },
    });
    if (!voice.ok) return resourceError(voice);
    const roles = await validateResources(guildId, {
      roles: { ids: [...value.allowedRoleIds, ...value.playlistRoleIds] },
    });
    return roles.ok ? null : resourceError(roles);
  },
  view: musicView,
  save: (guildId, state) => {
    const row = fromMusicDto(state);
    musicQueries.upsert.run({
      guild_id: guildId,
      command_channel_id: row.command_channel_id,
      voice_channel_ids_json: JSON.stringify(row.voice_channel_ids),
      allowed_role_ids_json: JSON.stringify(row.allowed_role_ids),
      leave_after_seconds: row.leave_after_seconds,
      playlists_enabled: +row.playlists_enabled,
      playlist_role_ids_json: JSON.stringify(row.playlist_role_ids),
    });
    invalidateMusicSettings(guildId);
  },
  section: AUDIT_SECTION.music,
  prefix: "Настройки музыки: ",
  saveMissing: true,
});
