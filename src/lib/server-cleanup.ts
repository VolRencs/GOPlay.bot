import { withTransaction } from "../db/database.ts";
import { stmt } from "../db/statements.ts";
import { forgetGuildMessages } from "../db/message-cache.ts";
import { clearWarns } from "./warns.ts";
import { deleteEventsByGuild } from "./events.ts";
import { invalidateMusicSettings } from "./music-settings.ts";
import type { CleanupTarget } from "./labels.ts";

const statsDeletes = [stmt.cleanupStatsMetrics, stmt.cleanupStatsChannelStats, stmt.cleanupStatsUserStats, stmt.cleanupStatsHourlyMessages];

// Полный набор для стирания сервера. Шире пользовательского списка в
// labels.ts: «Музыка» — настройки со страницы панели, а не накопленные
// данные, поэтому в очистке её нет; но при выходе бота / админ-wipe удаляется.
const WIPE_TARGETS: CleanupTarget[] = ["audit", "appeals", "warns", "stats", "events", "music", "levels"];

export function runCleanupTarget(guildId: string, target: CleanupTarget): number {
  // Каждая категория — одна транзакция: сбой посередине не оставит
  // полустёртую статистику или несброшенный счётчик апелляций.
  if (target === "audit") return withTransaction(() => Number(stmt.cleanupAudit.run(guildId).changes));
  if (target === "appeals") return withTransaction(() => {
    const removed = Number(stmt.cleanupAppeals.run(guildId).changes);
    stmt.cleanupAppealCounter.run(guildId);
    return removed;
  });
  if (target === "warns") return clearWarns(guildId, null);
  if (target === "music") { invalidateMusicSettings(guildId); return Number(stmt.cleanupMusic.run(guildId).changes); }
  if (target === "levels") return Number(stmt.cleanupLevels.run(guildId).changes);
  if (target === "events") return deleteEventsByGuild(guildId);
  return withTransaction(() => {
    let removed = 0;
    for (const del of statsDeletes) removed += Number(del.run(guildId).changes);
    return removed;
  });
}

// Кэш текстов сообщений не связан FK с guilds — чистится явно, вместе с
// буфером (иначе следующий флеш вернул бы стёртые строки).
function purgeMessageCache(guildId: string) {
  forgetGuildMessages(guildId);
  stmt.cleanupMessageCache.run(guildId);
}

// Полное стирание всех данных сервера: все категории очистки, кэш текстов и
// сама строка guilds — внешние ключи каскадом удаляют остальные настройки
// (приветствия, автомодерацию, панели, embeds, пресеты временных каналов).
// Используется выходом бота с сервера (GuildDelete) и админ-wipe. Журнал
// аудита уходит вместе с сервером — следов стирания намеренно не остаётся.
// Порядок важен: таргет "appeals" удаляет апелляции до строки гильдии, иначе
// FK appeals.punishment_id (без ON DELETE) заблокировал бы каскад.
export function wipeGuildData(guildId: string) {
  withTransaction(() => {
    for (const target of WIPE_TARGETS) runCleanupTarget(guildId, target);
    purgeMessageCache(guildId);
    stmt.cleanupGuild.run(guildId);
  });
}

// Ретеншн завершённых событий (участники и напоминания каскадом): вызывается
// из периодической очистки метрик (src/bot/metrics.ts) — без него таблица росла бы вечно.
export function pruneOldEvents(): number {
  return Number(stmt.eventsPrune.run(Date.now() - 90 * 86_400_000).changes);
}
