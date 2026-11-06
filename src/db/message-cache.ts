import { withTransaction } from "./database.ts";
import { logger } from "../lib/logger.ts";
import { stmt } from "./statements.ts";

export const MESSAGE_CACHE_PER_GUILD = 1000;

type PendingEntry = { guildId: string; channelId: string; content: string; createdAt: number };
const pending = new Map<string, PendingEntry>();
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
    flushTimer = setInterval(flushMessageCache, 5_000).unref();
  }
}

let flushFailures = 0;
export function flushMessageCache(): void {
  if (!pending.size) return;
  const entries = [...pending.entries()];
  pending.clear();
  const touchedGuilds = new Set<string>();
  try {
    withTransaction(() => {
      for (const [messageId, entry] of entries) {
        stmt.messageUpsert.run({ message_id: messageId, guild_id: entry.guildId, channel_id: entry.channelId, content: entry.content, created_at: entry.createdAt });
        touchedGuilds.add(entry.guildId);
      }
    });
  } catch (error) {
    for (const [messageId, entry] of entries) if (!pending.has(messageId)) rememberPending(messageId, entry);
    flushFailures = logger.warnEvery(flushFailures, 60, "[CACHE] Не удалось слить кэш сообщений — повторю позже", error);
    return;
  }
  flushFailures = 0;
  try {
    for (const guildId of touchedGuilds) enforceMessageCap(guildId);
  } catch (error) {
    logger.warn("[CACHE] Не удалось обрезать кэш сообщений", error);
  }
}


export function forgetGuildMessages(guildId: string): void {
  for (const [messageId, entry] of pending) if (entry.guildId === guildId) pending.delete(messageId);
}

export function rememberMessage(messageId: string, guildId: string, channelId: string, content: string, at: number = Date.now()): void {
  const existing = pending.get(messageId);
  if (existing) pending.set(messageId, { ...existing, content });
  else rememberPending(messageId, { guildId, channelId, content, createdAt: at });
  ensureFlushTimer();
}

export function enforceMessageCap(guildId: string): void {
  stmt.messagePrune.run(guildId, guildId, MESSAGE_CACHE_PER_GUILD - 1);
}

export function messageContent(messageId: string): string | null {
  const buffered = pending.get(messageId);
  if (buffered) return buffered.content;
  const row = stmt.messageGet.get(messageId);
  return row?.content ?? null;
}

export function forgetMessage(messageId: string): string | null {
  const buffered = pending.get(messageId);
  pending.delete(messageId);
  const content = buffered?.content ?? stmt.messageGet.get(messageId)?.content ?? null;
  stmt.messageDelete.run(messageId);
  return content;
}
