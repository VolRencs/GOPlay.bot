import { stmt } from "../bot/db/statements.ts";
import { parseStringArray } from "./json.ts";
import { clampMusicSeconds } from "./labels.ts";

export type MusicSettings = { command_channel_id: string | null; voice_channel_ids: string[]; allowed_role_ids: string[]; leave_after_seconds: number };

export function musicSettingsFor(guildId: string): MusicSettings {
  const row = stmt.musicSettings.get(guildId) as { command_channel_id?: string | null; voice_channel_ids_json?: string; allowed_role_ids_json?: string; leave_after_seconds?: number } | undefined;
  return {
    command_channel_id: row?.command_channel_id ?? null,
    voice_channel_ids: parseStringArray(row?.voice_channel_ids_json),
    allowed_role_ids: parseStringArray(row?.allowed_role_ids_json),
    // Значение из БД прошлых версий может быть любым числом: клампим к тому же
    // диапазону, что и API записи (0 = выключено, иначе 30..3600).
    leave_after_seconds: clampMusicSeconds(row?.leave_after_seconds ?? 300),
  };
}
