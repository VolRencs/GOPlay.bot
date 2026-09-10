import { stmt } from "./db/statements.ts";
import { logger } from "./utils/logger.ts";
import { unrefInterval } from "./utils/timers.ts";
import { db, withTransaction } from "../db/database.ts";
import { time } from "./perf.ts";
import { pruneOldEvents } from "../lib/server-cleanup.ts";

type MetricKey = "joins" | "leaves" | "messages" | "moderation";
type Counts = Record<MetricKey, number>;

const pending = new Map<string, Map<string, Counts>>();
const messageUsers = new Map<string, Set<string>>();
const flushedUsers = new Map<string, Set<string>>();
const channelCounts = new Map<string, Map<string, number>>();
const userCounts = new Map<string, Map<string, number>>();
const hourlyCounts = new Map<string, Map<number, number>>();

let timer: ReturnType<typeof setInterval> | null = null;
const FLUSH_INTERVAL = 5_000;
const RETENTION_DAYS = 31;
const CLEANUP_INTERVAL = 10 * 60_000;

const today = () => new Date().toISOString().slice(0, 10);

function countsFor(guildId: string, day: string): Counts {
  let days = pending.get(guildId);
  if (!days) { days = new Map(); pending.set(guildId, days); }
  let counts = days.get(day);
  if (!counts) { counts = { joins: 0, leaves: 0, messages: 0, moderation: 0 }; days.set(day, counts); }
  return counts;
}

function ensureTimer() {
  if (!timer) { timer = unrefInterval(flushMetrics, FLUSH_INTERVAL); }
}

export function addMetric(guildId: string, metric: MetricKey) {
  countsFor(guildId, today())[metric] += 1;
  ensureTimer();
}

export function addMessage(guildId: string, channelId: string, userId: string, at = Date.now()) {
  const date = new Date(at);
  const day = date.toISOString().slice(0, 10);
  const hour = date.getUTCHours();
  const key = `${guildId}:${day}`;
  countsFor(guildId, day).messages += 1;
  if (!flushedUsers.get(key)?.has(userId)) {
    const users = messageUsers.get(key) ?? new Set<string>();
    users.add(userId);
    messageUsers.set(key, users);
  }
  const channels = channelCounts.get(key) ?? new Map<string, number>();
  channels.set(channelId, (channels.get(channelId) ?? 0) + 1);
  channelCounts.set(key, channels);
  const byUser = userCounts.get(key) ?? new Map<string, number>();
  byUser.set(userId, (byUser.get(userId) ?? 0) + 1);
  userCounts.set(key, byUser);
  const hours = hourlyCounts.get(key) ?? new Map<number, number>();
  hours.set(hour, (hours.get(hour) ?? 0) + 1);
  hourlyCounts.set(key, hours);
  ensureTimer();
}

let flushFailures = 0;
const MODERATION_RETENTION_DAYS = 90;
const moderationPrune = db.prepare("DELETE FROM moderation_actions WHERE created_at < ? AND id NOT IN(SELECT punishment_id FROM appeals)");
function noteFlushFailure(error: unknown, started: number): void {
  flushFailures = logger.warnEvery(flushFailures, 60, "Не удалось записать метрики — окно будет отправлено повторно", error);
  time("db.metrics_flush", performance.now() - started);
}

type FlushRow = { guildId: string; day: string; key: string; counts: Counts; activeUsersDelta: number; peak: number };

export function flushMetrics() {
  // Пустой буфер: не открываем BEGIN IMMEDIATE каждые 5 c — соседний
  // flushMessageCache делает так же. Все буферы наполняются только через countsFor.
  if (!pending.size) return;
  const started = performance.now();
  const rows: FlushRow[] = [];
  const newActive: { key: string; ids: string[] }[] = [];
  for (const [guildId, days] of pending) for (const [day, counts] of days) {
    const key = `${guildId}:${day}`;
    const users = messageUsers.get(key), flushed = flushedUsers.get(key) ?? new Set<string>();
    const fresh = users ? [...users].filter(id => !flushed.has(id)) : [];
    if (fresh.length) newActive.push({ key, ids: fresh });
    rows.push({ guildId, day, key, counts, activeUsersDelta: fresh.length, peak: Math.max(0, ...(hourlyCounts.get(key)?.values() ?? [])) });
  }
  try {
    commitWindow(rows);
  } catch (error) {
    if (!isForeignKeyError(error)) { noteFlushFailure(error, started); return; }
    logger.warn("Метрики содержали данные стёртой гильдии — ключи выкинуты, повторяю флеш");
    evictDeadGuildKeys();
    try { commitWindow(rows); } catch (retryError) { noteFlushFailure(retryError, started); return; }
  }
  flushFailures = 0;
  for (const entry of newActive) { const flushed = flushedUsers.get(entry.key) ?? new Set<string>(); for (const id of entry.ids) flushed.add(id); flushedUsers.set(entry.key, flushed); }
  pending.clear();
  channelCounts.clear();
  userCounts.clear();
  hourlyCounts.clear();
  time("db.metrics_flush", performance.now() - started);
}

function commitWindow(rows: FlushRow[]): void {
  withTransaction(() => {
    for (const row of rows) {
      stmt.metric.run(row.guildId, row.day, row.counts.joins, row.counts.leaves, row.counts.messages, row.counts.moderation, row.activeUsersDelta, row.peak);
      const channels = channelCounts.get(row.key);
      if (channels) for (const [channelId, messages] of channels) stmt.channelMetric.run(row.guildId, row.day, channelId, messages);
      const byUser = userCounts.get(row.key);
      if (byUser) for (const [userId, messages] of byUser) stmt.userMetric.run(row.guildId, row.day, userId, messages);
      const hours = hourlyCounts.get(row.key);
      if (hours) for (const [hour, messages] of hours) stmt.hourlyMetric.run(row.guildId, row.day, hour, messages);
    }
  });
}

function isForeignKeyError(error: unknown): boolean {
  return error instanceof Error && /FOREIGN KEY/i.test(error.message);
}

/** Выкидывает из буферов дельты гильдий, которых уже нет в БД. */
function evictDeadGuildKeys(): void {
  let alive: Set<string>;
  try { alive = new Set((stmt.guildIds.all() as { id: string }[]).map(r => r.id)); }
  catch { return; }
  for (const guildId of [...pending.keys()]) if (!alive.has(guildId)) pending.delete(guildId);
  for (const map of [channelCounts, userCounts, hourlyCounts, messageUsers, flushedUsers]) {
    for (const key of [...map.keys()]) if (!alive.has(key.slice(0, key.indexOf(":")))) map.delete(key);
  }
}

// Ретеншн агрегатов: детальные таблицы не растут бесконечно. Дневные строки
unrefInterval(() => {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const cleanup of [stmt.cleanupChannelStats, stmt.cleanupUserStats, stmt.cleanupHourlyStats, stmt.cleanupDailyStats]) cleanup.run(cutoff);
    moderationPrune.run(Date.now() - MODERATION_RETENTION_DAYS * 86_400_000);
    pruneOldEvents();
    const minDay = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    for (const key of messageUsers.keys()) if (key.slice(key.indexOf(":") + 1) < minDay) { messageUsers.delete(key); flushedUsers.delete(key); }
  } catch (error) {
    logger.warn("Очистка статистики не удалась", error);
  }
}, CLEANUP_INTERVAL);