import { withTransaction } from "../../db/database.ts";
import { logger } from "../utils/logger.ts";
import { stmt } from "./statements.ts";

// Сколько новейших сообщений на гильдию держим для логов правок/удалений.
// Кап ленивый (enforceMessageCap + троттлинг prune ниже) — таблица не растёт
// заметно дальше 1000 строк на гильдию.
export const MESSAGE_CACHE_PER_GUILD = 1000;

// Discord не присылает прежний текст правки — бот помнит увиденный контент.
// Записи буферизуются в памяти и сливаются одной короткой транзакцией раз в
// 5 секунд (вместе с метриками): MessageCreate остаётся полностью write-free,
// исчезает главный источник SQLITE_BUSY-гонок двух процессов. Окно потери при
// падении процесса — ≤5 секунд контента, что для журнала правок несущественно.
type PendingEntry = { guildId: string; channelId: string; content: string; createdAt: number };
const pending = new Map<string, PendingEntry>(); // ключ — messageId
// Защита памяти: если БД недоступна часами, повторная постановка неудачных
// флешей росла бы без границ (десятки сообщений/с × ~500 Б → ГБ за день).
// При переполнении выкидываем самые старые вставки — журнал правок и так
// ограничен 1000 строками на гильдию, потеря хвоста буфера на неё не влияет.
const PENDING_CAP = 10_000;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function rememberPending(messageId: string, entry: PendingEntry): void {
  while (pending.size >= PENDING_CAP) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
  pending.set(messageId, entry);
}

function ensureFlushTimer(): void {
  if (!flushTimer) {
    flushTimer = setInterval(flushMessageCache, 5_000);
    flushTimer.unref?.();
  }
}

let flushFailures = 0;
/** Немедленно сливает буфер в БД одной транзакцией (+ тесты). */
export function flushMessageCache(): void {
  if (!pending.size) return;
  const entries = [...pending.entries()];
  pending.clear();
  const touchedGuilds = new Set<string>();
  try {
    withTransaction(() => {
      for (const [messageId, entry] of entries) {
        stmt.messageUpsert.run(messageId, entry.guildId, entry.channelId, entry.content, entry.createdAt);
        touchedGuilds.add(entry.guildId);
      }
    });
  } catch (error) {
    // Возвращаем записи в буфер — следующая попытка через 5 секунд. При длинном
    // простое БД логируем первую и каждую 60-ю попытку (раз в ~5 минут).
    for (const [messageId, entry] of entries) if (!pending.has(messageId)) rememberPending(messageId, entry);
    flushFailures += 1;
    if (flushFailures === 1 || flushFailures % 60 === 0)
      logger.warn("[CACHE] Не удалось слить кэш сообщений — повторю позже", error, `повтор #${flushFailures}`);
    return;
  }
  flushFailures = 0;
  for (const guildId of touchedGuilds) enforceMessageCap(guildId);
}

// Prune не обязан выполняться на каждом сообщении сервера: раз в 30 c на
// гильдию достаточно, чтобы держать таблицу у капа.
const nextPruneAt = new Map<string, number>();

/** Сброс троттлинга prune (при полном стирании гильдии). */
function resetPruneThrottle(guildId: string): void {
  nextPruneAt.delete(guildId);
}

/** Гильдия стёрта (wipe): буфер не должен вернуть её сообщения следующим
 *  флешем — у таблицы нет FK, сироты остались бы навсегда. */
export function forgetGuildMessages(guildId: string): void {
  for (const [messageId, entry] of pending) if (entry.guildId === guildId) pending.delete(messageId);
  resetPruneThrottle(guildId);
}

export function rememberMessage(messageId: string, guildId: string, channelId: string, content: string, at: number = Date.now()): void {
  const existing = pending.get(messageId);
  if (existing) pending.set(messageId, { ...existing, content });
  else rememberPending(messageId, { guildId, channelId, content, createdAt: at });
  ensureFlushTimer();
  const now = Date.now();
  if (now < (nextPruneAt.get(guildId) ?? 0)) return;
  nextPruneAt.set(guildId, now + 30_000);
  enforceMessageCap(guildId);
}

/** Немедленная обрезка гильдии до капа (используется и тестами). */
export function enforceMessageCap(guildId: string): void {
  stmt.messagePrune.run(guildId, guildId, MESSAGE_CACHE_PER_GUILD - 1);
}

export function messageContent(messageId: string): string | null {
  const buffered = pending.get(messageId);
  if (buffered) return buffered.content;
  const row = stmt.messageGet.get(messageId) as { content: string } | undefined;
  return row?.content ?? null;
}

// Возвращает сохранённый текст (для лога удаления) и удаляет строку.
// Непросмотренное сообщение даёт null, как будто его не было.
export function forgetMessage(messageId: string): string | null {
  const buffered = pending.get(messageId);
  pending.delete(messageId);
  if (buffered) {
    // Старая слитая копия тоже удаляется — актуален именно буфер.
    stmt.messageDelete.run(messageId);
    return buffered.content;
  }
  const row = stmt.messageGet.get(messageId) as { content: string } | undefined;
  stmt.messageDelete.run(messageId);
  return row?.content ?? null;
}
