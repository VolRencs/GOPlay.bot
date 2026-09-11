import { db, withTransaction } from "../db/database.ts";
import { forgetGuildMessages } from "../bot/db/message-cache.ts";
import { clearWarns } from "./warns.ts";
import { deleteEventsByGuild } from "./events.ts";
import type { CleanupTarget } from "./labels.ts";

const auditDelete = db.prepare("DELETE FROM dashboard_audit WHERE guild_id=?");
const appealsDelete = db.prepare("DELETE FROM appeals WHERE guild_id=?");
const appealCounterReset = db.prepare("UPDATE guilds SET appeal_counter=0 WHERE id=?");
const musicDelete = db.prepare("DELETE FROM music_settings WHERE guild_id=?");
const levelsDelete = db.prepare("DELETE FROM member_levels WHERE guild_id=?");
const statsDeletes = ["guild_daily_metrics", "guild_daily_channel_stats", "guild_daily_user_stats", "guild_hourly_messages"]
  .map(table => db.prepare(`DELETE FROM ${table} WHERE guild_id=?`));
const messageCacheDelete = db.prepare("DELETE FROM message_cache WHERE guild_id=?");
const guildDelete = db.prepare("DELETE FROM guilds WHERE id=?");

// Полный набор для стирания сервера. Шире пользовательского списка в
// labels.ts: «Музыка» — настройки со страницы панели, а не накопленные
// данные, поэтому в очистке её нет; но при выходе бота / админ-wipe удаляется.
const WIPE_TARGETS: CleanupTarget[] = ["audit", "appeals", "warns", "stats", "events", "music", "levels"];

export function runCleanupTarget(guildId: string, target: CleanupTarget): number {
  // Каждая категория — одна транзакция: сбой посередине не оставит
  // полустёртую статистику или несброшенный счётчик апелляций.
  if (target === "audit") return withTransaction(() => Number(auditDelete.run(guildId).changes));
  if (target === "appeals") return withTransaction(() => {
    const removed = Number(appealsDelete.run(guildId).changes);
    appealCounterReset.run(guildId);
    return removed;
  });
  if (target === "warns") return clearWarns(guildId, null);
  if (target === "music") return Number(musicDelete.run(guildId).changes);
  if (target === "levels") return Number(levelsDelete.run(guildId).changes);
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
  messageCacheDelete.run(guildId);
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
    guildDelete.run(guildId);
  });
}

// Ретеншн завершённых событий (участники и напоминания каскадом): разовая
// чистка при апгрейде — без рантайм-аналога таблицы росли бы вечно.
const eventsPrune = db.prepare("DELETE FROM events WHERE status IN ('completed','cancelled') AND scheduled_at < ?");
export function pruneOldEvents(): number {
  return Number(eventsPrune.run(Date.now() - 90 * 86_400_000).changes);
}
