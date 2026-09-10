import { stmt } from "../bot/db/statements.ts";
import { clampNumber } from "./constants.ts";
import { parseStringArray } from "./json.ts";
import { levelDefaults, levelRanges, notifyModes, type LevelReward, type LevelSettings, type NotifyMode } from "./levels.ts";

// Доступ к БД системы уровней: только серверная сторона (бот и API-роут).
// Клиентская панель импортирует чистый levels.ts без node:sqlite.

const clampInt = (value: unknown, fallback: number, range: { min: number; max: number }): number => clampNumber(value, fallback, range.min, range.max, "integer");

/** Единый парсер настроек для бота и API: клампы те же, что и при записи. */
export function levelSettingsFor(guildId: string): LevelSettings {
  const row = stmt.levelSettings.get(guildId) as Record<string, unknown> | undefined;
  if (!row) return { ...levelDefaults, ignored_channel_ids: [], ignored_role_ids: [] };
  return {
    enabled: Boolean(row.enabled),
    xp_per_message: clampInt(row.xp_per_message, levelDefaults.xp_per_message, levelRanges.xp_per_message),
    message_cooldown_seconds: clampInt(row.message_cooldown_seconds, levelDefaults.message_cooldown_seconds, levelRanges.message_cooldown_seconds),
    min_message_length: clampInt(row.min_message_length, levelDefaults.min_message_length, levelRanges.min_message_length),
    xp_per_voice_minute: clampInt(row.xp_per_voice_minute, levelDefaults.xp_per_voice_minute, levelRanges.xp_per_voice_minute),
    base_xp: clampInt(row.base_xp, levelDefaults.base_xp, levelRanges.base_xp),
    growth_percent: clampInt(row.growth_percent, levelDefaults.growth_percent, levelRanges.growth_percent),
    ignored_channel_ids: parseStringArray(row.ignored_channel_ids_json as string | null),
    ignored_role_ids: parseStringArray(row.ignored_role_ids_json as string | null),
    notify_mode: notifyModes.includes(row.notify_mode as NotifyMode) ? row.notify_mode as NotifyMode : levelDefaults.notify_mode,
    notify_channel_id: typeof row.notify_channel_id === "string" ? row.notify_channel_id : null,
  };
}

export function levelRewardsFor(guildId: string): LevelReward[] {
  return stmt.levelRewardsAll.all(guildId) as LevelReward[];
}
