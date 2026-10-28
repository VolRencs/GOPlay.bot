import { stmt } from "../db/statements.ts";
import { ttlCacheSync } from "./cache.ts";
import { parseStringArray } from "./json.ts";
import { clampMusicSeconds } from "./labels.ts";
import { DEFAULT_MUSIC_LEAVE_SECONDS } from "./constants.ts";

export type MusicSettings = {
  command_channel_id: string | null;
  voice_channel_ids: string[];
  allowed_role_ids: string[];
  leave_after_seconds: number;
  playlists_enabled: boolean;
  playlist_role_ids: string[];
};

/** Строка таблицы music_settings (JSON-массивы в сыром виде): общий тип API. */
export type MusicSettingsRow = {
  command_channel_id: string | null;
  voice_channel_ids_json: string;
  allowed_role_ids_json: string;
  leave_after_seconds: number;
  playlists_enabled: number;
  playlist_role_ids_json: string;
};

function loadMusicSettings(guildId: string): MusicSettings {
  const row = stmt.musicSettings.get(guildId) as Partial<MusicSettingsRow> | undefined;
  return {
    command_channel_id: row?.command_channel_id ?? null,
    voice_channel_ids: parseStringArray(row?.voice_channel_ids_json),
    allowed_role_ids: parseStringArray(row?.allowed_role_ids_json),
    // Значение из БД прошлых версий может быть любым числом: клампим к тому же
    // диапазону, что и API записи (0 = выключено, иначе 30..3600).
    leave_after_seconds: clampMusicSeconds(row?.leave_after_seconds ?? DEFAULT_MUSIC_LEAVE_SECONDS),
    playlists_enabled: row?.playlists_enabled !== 0,
    playlist_role_ids: parseStringArray(row?.playlist_role_ids_json),
  };
}

const settingsCache = ttlCacheSync<string, MusicSettings>(loadMusicSettings, 10_000);

export function musicSettingsFor(guildId: string): MusicSettings {
  return settingsCache.get(guildId);
}

/** PUT настроек и очистка гильдии обязаны сбросить кэш. */
export function invalidateMusicSettings(guildId: string): void {
  settingsCache.delete(guildId);
}
