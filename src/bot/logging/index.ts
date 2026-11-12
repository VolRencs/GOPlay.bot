import { EmbedBuilder, type Client, type Guild, type GuildAuditLogsEntry, type SendableChannels } from "discord.js";
import { stmt } from "../../db/statements.ts";
import { logger } from "../../lib/logger.ts";
import { count, time } from "../../lib/perf.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { safeJson } from "../../lib/json.ts";
import { ttlCacheAsync, ttlCacheSync } from "../../lib/cache.ts";
import { isMissingDiscordResource } from "../../lib/errors.ts";
import { logTitleFor } from "../../lib/labels.ts";
import { guildLang, trFor } from "../../lib/i18n/bot.ts";
import { logTr } from "../../lib/i18n/bot/logs.ts";
import { BRAND_COLOR } from "../../lib/colors.ts";
import { channelRef, userRef } from "../../lib/format.ts";
import { isEmbedLimitError, takeLogBatch } from "../../lib/log-batch.ts";

let client: Client | null = null;
export function initLogging(c: Client) { client = c; }

const SETTINGS_TTL = 5_000;
const settingsCache = ttlCacheSync<string, { channelId: string | null; categories: Record<string, boolean> }>((guildId) => {
  count("db.settings_load");
  try {
    const setting = stmt.loggingSettings.get(guildId);
    return { channelId: setting?.channel_id ?? null, categories: safeJson<Record<string, boolean>>(setting?.categories_json, {}) };
  } catch (error) {
    logger.warn("[LOG] Не удалось прочитать настройки логирования", guildId, error);
    return { channelId: null, categories: {} };
  }
}, SETTINGS_TTL);

const queues = new Map<string, EmbedBuilder[]>();
const draining = new Set<string>();
const MAX_ATTEMPTS = 3;
const NEGATIVE_CACHE_TTL = 60_000;
const channelCache = ttlCacheAsync<string, SendableChannels | null>((channelId) => {
  if (!client) return Promise.resolve(null);
  return client.channels.fetch(channelId).then(channel => channel && "isTextBased" in channel && channel.isTextBased() ? (channel as SendableChannels) : null).catch((error) => {
    if (isMissingDiscordResource(error, "channel")) return null;
    logger.warn("[LOG] Канал недоступен (транзиентная ошибка, не кэшируем)", channelId, error);
    throw error;
  });
}, NEGATIVE_CACHE_TTL);

let resolveFailures = 0;
export async function resolveChannel(channelId: string, strict = false): Promise<SendableChannels | null> {
  if (!client) return null;
  try {
    const channel = await channelCache.get(channelId);
    resolveFailures = 0;
    return channel;
  } catch (error) {
    if (strict) throw error;
    resolveFailures = logger.warnEvery(resolveFailures, 20, "[LOG] Канал недоступен", channelId, error);
    return null;
  }
}

const MAX_QUEUE = 1000;
const RETRY_DELAY = 30_000;
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function enqueueLog(channelId: string, embed: EmbedBuilder) {
  const list = queues.get(channelId) ?? [];
  if (list.length >= MAX_QUEUE) {
    const dropped = list.splice(0, list.length - MAX_QUEUE + 1);
    logger.error("[LOG] Очередь логов переполнена, старые записи отброшены.", channelId, dropped.length);
  }
  list.push(embed);
  queues.set(channelId, list);
  void drainChannel(channelId);
}

// Discord allows 10 embeds per message but limits the combined text to 6000 characters.
const EMBEDS_PER_MESSAGE = 10;
const MAX_EMBED_CHARS = 5900;

async function drainChannel(channelId: string) {
  if (draining.has(channelId)) return;
  draining.add(channelId);
  let requeued = false;
  let maxEmbeds = EMBEDS_PER_MESSAGE;
  let maxChars = MAX_EMBED_CHARS;
  try {
    while (true) {
      const queue = queues.get(channelId) ?? [];
      const batch = takeLogBatch(queue, maxEmbeds, maxChars);
      if (!batch.length) break;
      let attempts = 0;
      let sent = false;
      let permanent = false;
      while (true) {
        let channel: SendableChannels | null;
        try {
          channel = await resolveChannel(channelId, true);
        } catch (error) {
          attempts += 1;
          if (attempts >= MAX_ATTEMPTS) {
            logger.error("[LOG] Канал логов временно недоступен, пакет отложен.", channelId, batch.length, error);
            break;
          }
          logger.warn(`[LOG] Ошибка получения канала логов, попытка ${attempts}/${MAX_ATTEMPTS}`, channelId, error);
          await sleep(1_000 * attempts);
          continue;
        }
        if (!channel) {
          permanent = true;
          logger.error("[LOG] Канал логов недоступен, пакет отброшен.", channelId, batch.length);
          break;
        }
        try {
          await channel.send({ embeds: batch });
          sent = true;
          break;
        } catch (error) {
          if (isMissingDiscordResource(error, "channel")) {
            permanent = true;
            logger.error("[LOG] Канал логов удалён, пакет отброшен.", channelId, batch.length, error);
            break;
          }
          if (isEmbedLimitError(error)) {
            if (batch.length > 1) {
              const list = queues.get(channelId) ?? [];
              list.unshift(...batch);
              queues.set(channelId, list);
              maxEmbeds = Math.max(1, Math.floor(batch.length / 2));
              maxChars = Math.max(1, Math.floor(maxChars / 2));
              logger.warn("[LOG] Discord отклонил пакет embed'ов, уменьшаю размер.", channelId, batch.length, maxEmbeds);
              continue;
            }
            permanent = true;
            logger.error("[LOG] Discord отклонил embed, запись отброшена.", channelId, error);
            break;
          }
          attempts += 1;
          if (attempts >= MAX_ATTEMPTS) {
            logger.error("[LOG] Пакет логов не отправлен после повторных попыток.", channelId, batch.length, error);
            break;
          }
          logger.warn(`[LOG] Ошибка отправки пакета логов, попытка ${attempts}/${MAX_ATTEMPTS}`, channelId, error);
          await sleep(1_000 * attempts);
        }
      }
      if (!sent && !permanent) {
        const list = queues.get(channelId) ?? [];
        list.unshift(...batch);
        queues.set(channelId, list);
        requeued = true;
        break;
      }
    }
  } finally {
    draining.delete(channelId);
  }
  const pending = queues.get(channelId);
  if (!pending?.length) {
    queues.delete(channelId);
    const timer = retryTimers.get(channelId);
    if (timer) { clearTimeout(timer); retryTimers.delete(channelId); }
    return;
  }
  if (requeued) {
    if (!retryTimers.has(channelId)) {
      const timer = setTimeout(() => { retryTimers.delete(channelId); void drainChannel(channelId); }, RETRY_DELAY).unref();
      retryTimers.set(channelId, timer);
    }
  } else void drainChannel(channelId);
}

export async function flushLogs(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (const channelId of queues.keys()) void drainChannel(channelId);
  while (Date.now() < deadline) {
    const pending = [...queues.values()].reduce((sum, list) => sum + list.length, 0);
    if (!pending && !draining.size) return;
    await sleep(100);
  }
  logger.warn("[LOG] Часть логов не успела отправиться при остановке");
}

const botActions = new Map<string, number>();
const BOT_ACTION_TTL = 15_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, at] of botActions) if (now - at > BOT_ACTION_TTL) botActions.delete(key);
}, 60_000).unref();
export function markBotAction(guildId: string, type: string, targetId: string) { botActions.set(`${guildId}:${type}:${targetId}`, Date.now()); }
export function isBotAction(guildId: string, type: string, targetId: string) {
  const key = `${guildId}:${type}:${targetId}`;
  const at = botActions.get(key);
  if (at === undefined) return false;
  botActions.delete(key);
  return Date.now() - at <= BOT_ACTION_TTL;
}

type AuditRequest = { guildId: string; type: number; targetId: string; priority: boolean; resolve: (entry: GuildAuditLogsEntry<number> | undefined) => void };
const auditQueue: AuditRequest[] = [];
let auditWorker: Promise<void> | null = null;
let auditFailures = 0;
const AUDIT_INTERVAL = 300;
const AUDIT_QUEUE_LIMIT = 250;

// Discord audit log is eventually consistent; retry lookups instead of losing the actor.
function auditLookup(guildId: string, type: number, targetId: string, priority: boolean) {
  return new Promise<GuildAuditLogsEntry<number> | undefined>(resolve => {
    const request = { guildId, type, targetId, priority, resolve };
    if (priority) auditQueue.unshift(request);
    else auditQueue.push(request);
    if (auditQueue.length > AUDIT_QUEUE_LIMIT) {
      const dropAt = auditQueue.findIndex(entry => !entry.priority);
      const [dropped] = auditQueue.splice(dropAt === -1 ? 0 : dropAt, 1);
      dropped!.resolve(undefined);
    }
    void drainAuditQueue();
  });
}

async function drainAuditQueue() {
  if (auditWorker) return;
  auditWorker = (async () => {
    while (auditQueue.length) {
      const { guildId, type, targetId, resolve } = auditQueue.shift()!;
      const guild = client?.guilds.cache.get(guildId);
      if (!guild) { resolve(undefined); continue; }
      const started = performance.now();
      const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(error => { auditFailures = logger.warnEvery(auditFailures, 20, "[AUDIT] Не удалось получить журнал аудита", guildId, error); return null; });
      time("audit.rest", performance.now() - started);
      count("audit.lookups");
      const entry = logs?.entries.find(x => x.targetId === targetId && Date.now() - x.createdTimestamp < 15_000);
      resolve(entry);
      if (auditQueue.length) await sleep(AUDIT_INTERVAL);
    }
  })().catch(error => { logger.warn("[AUDIT] Очередь журнала аудита прервана", error); }).finally(() => {
    auditWorker = null;
    if (auditQueue.length) void drainAuditQueue();
  });
}

type AuditFindOptions = { priority?: boolean; retries?: number; retryDelay?: number };

export async function auditFind(guild: Guild, type: number, targetId: string, opts: AuditFindOptions = {}): Promise<GuildAuditLogsEntry<number> | undefined> {
  const { priority = false, retries = 1, retryDelay = 1_500 } = opts;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const entry = await auditLookup(guild.id, type, targetId, priority);
    if (entry) return entry;
    if (attempt < retries) await sleep(retryDelay);
  }
  return undefined;
}

export async function auditActor(guild: Guild, type: number, targetId: string, opts?: AuditFindOptions) {
  return (await auditFind(guild, type, targetId, opts))?.executor?.id;
}

type LogActionInput = { guildId: string; type: string; targetId: string; moderatorId?: string | undefined; details: string };

const logColors: Record<string, number> = {
  member_ban: 0xed4245,
  member_kick: 0xed4245,
  message_delete: 0xed4245,
  message_purge: 0xed4245,
  channel_delete: 0xed4245,
  member_join: 0x57f287,
  member_unban: 0x57f287,
  channel_create: 0x57f287,
  member_warn: 0xfaa61a,
  member_warn_clear: 0xfaa61a,
};

function buildEmbed(guildId: string, settings: { channelId: string | null; categories: Record<string, boolean> }, input: Omit<LogActionInput, "guildId">): EmbedBuilder | null {
  const { type, targetId, moderatorId, details } = input;
  if (!settings.channelId) return null;
  const allowed = settings.categories[type] ?? true;
  if (!allowed) return null;
  const lang = guildLang(guildId);
  const t = trFor(logTr, lang);
  const channelEvent = type.startsWith("channel_") || type === "message_purge";
  const subject = targetId === "все" ? t("targetAllSubject") : targetId === t("unknownExecutor") ? targetId : channelEvent ? `${channelRef(targetId)} (ID: ${targetId})` : `${userRef(targetId)} (ID: ${targetId})`;
  const color = logColors[type] ?? BRAND_COLOR;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(logTitleFor(lang, type))
    .addFields({ name: channelEvent ? t("fieldChannel") : t("fieldMember"), value: subject }, { name: t("fieldDetails"), value: details.slice(0, 1024) || t("detailsEmpty") }, { name: t("fieldTime"), value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true });
  if (moderatorId) embed.addFields({ name: t("fieldExecutor"), value: moderatorId === "automod" ? t("autoModWord") : userRef(moderatorId) });
  return embed;
}

export function logAction(input: LogActionInput) {
  const { guildId, type, targetId, ...rest } = input;
  const settings = settingsCache.get(guildId);
  const embed = buildEmbed(guildId, settings, { type, targetId, ...rest });
  if (embed) enqueueLog(settings.channelId!, embed);
}
