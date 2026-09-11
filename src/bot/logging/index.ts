import { EmbedBuilder, type Client, type Guild, type GuildAuditLogsEntry, type SendableChannels } from "discord.js";
import { stmt } from "../db/statements.ts";
import { logger } from "../utils/logger.ts";
import { count, time } from "../perf.ts";
import { sleep } from "../../db/database.ts";
import { safeJson } from "../../lib/json.ts";
import { ttlCacheAsync, ttlCacheSync } from "../../lib/cache.ts";
import { isMissingDiscordResource } from "../../lib/errors.ts";
import { logTitleFor } from "../../lib/labels.ts";
import { guildLang } from "../../lib/i18n/bot.ts";
import { logTr } from "../../lib/i18n/bot/logs.ts";

let client: Client | null = null;
export function initLogging(c: Client) { client = c; }

// Настройки логирования кэшируются на пару секунд: горячие пути (удаления,
// диффы ролей) не блокируются на SQLite; правки панели применяются за TTL.
const SETTINGS_TTL = 5_000;
const settingsCache = ttlCacheSync<string, { channelId: string | null; categories: Record<string, boolean> }>((guildId) => {
  count("db.settings_load");
  const setting = stmt.loggingSettings.get(guildId) as { channel_id: string | null; categories_json: string } | undefined;
  return { channelId: setting?.channel_id ?? null, categories: safeJson<Record<string, boolean>>(setting?.categories_json, {}) };
}, SETTINGS_TTL);

// Очередь на канал + один отправитель: burst событий не упирается в rate
// limit и не теряет логи — фейлы ретраятся и только потом репортятся.
const queues = new Map<string, { embed: EmbedBuilder }[]>();
const draining = new Set<string>();
const MAX_ATTEMPTS = 3;
// Отрицательный результат кэшируется ТОЛЬКО для «канал действительно не
// существует» (404/10003). Транзиентные ошибки (сеть, rate limit) не кэшируются,
// иначе drain за 60 секунд израсходует попытки и логи будут потеряны.
const NEGATIVE_CACHE_TTL = 60_000;
const channelCache = ttlCacheAsync<string, SendableChannels | null>((channelId) => {
  if (!client) return Promise.resolve(null);
  return client.channels.fetch(channelId).then(channel => channel && "isTextBased" in channel && channel.isTextBased() ? (channel as SendableChannels) : null).catch((error) => {
    if (isMissingDiscordResource(error, "channel")) return null; // канал удалён — кэшируем
    logger.warn("[LOG] Канал недоступен (транзиентная ошибка, не кэшируем)", channelId, error);
    throw error;
  });
}, NEGATIVE_CACHE_TTL);

export async function resolveChannel(channelId: string): Promise<SendableChannels | null> {
  if (!client) return null;
  try {
    return await channelCache.get(channelId);
  } catch {
    return null;
  }
}

function enqueueLog(channelId: string, embed: EmbedBuilder) {
  const list = queues.get(channelId) ?? [];
  list.push({ embed });
  queues.set(channelId, list);
  void drainChannel(channelId);
}

// Лимит Discord на embeds в одном сообщении.
const EMBEDS_PER_MESSAGE = 10;

async function drainChannel(channelId: string) {
  if (draining.has(channelId)) return;
  draining.add(channelId);
  while (true) {
    // Батч до 10 embeds на POST: массовые удаления/пурджи дают ×10 меньше
    // REST-вызовов и не упираются в rate limit самого канала логов.
    const queue = queues.get(channelId) ?? [];
    const batch = queue.splice(0, EMBEDS_PER_MESSAGE);
    if (!batch.length) break;
    let attempts = 0;
    while (true) {
      const channel = await resolveChannel(channelId);
      try {
        if (!channel) throw new Error("Канал недоступен");
        await channel.send({ embeds: batch.map(item => item.embed) });
        break;
      } catch (error) {
        attempts += 1;
        if (attempts >= MAX_ATTEMPTS) {
          logger.error("[LOG] Пакет логов отброшен после повторных попыток.", channelId, batch.length, error);
          break;
        }
        logger.warn(`[LOG] Ошибка отправки пакета логов, попытка ${attempts}/${MAX_ATTEMPTS}`, channelId, error);
        await sleep(1_000 * attempts);
      }
    }
  }
  draining.delete(channelId);
  if (queues.get(channelId)?.length) void drainChannel(channelId);
  else queues.delete(channelId);
}

// Действия бота логируются сразу с известным исполнителем и помечаются, чтобы
// соответствующее gateway-событие не дублировало запись.
const botActions = new Map<string, number>();
const BOT_ACTION_TTL = 15_000;
export function markBotAction(guildId: string, type: string, targetId: string) { botActions.set(`${guildId}:${type}:${targetId}`, Date.now()); }
export function isBotAction(guildId: string, type: string, targetId: string) {
  const key = `${guildId}:${type}:${targetId}`;
  const at = botActions.get(key);
  if (at === undefined) return false;
  botActions.delete(key);
  return Date.now() - at <= BOT_ACTION_TTL;
}

// Audit-lookups — REST-вызовы из общего лимита аудита Discord. Один фоновый
// воркер дренирует глобальную FIFO в фиксированном темпе: всплески (массовые
// удаления, смены ролей) не бьют по API — лишние приходят без исполнителя,
// событие всё равно логируется. Kick/ban чувствительны ко времени (записи
// выбывают из окна матчинга) и идут вне очереди.
type AuditRequest = { guildId: string; type: number; targetId: string; priority: boolean; resolve: (entry: GuildAuditLogsEntry<number> | undefined) => void };
const auditQueue: AuditRequest[] = [];
let auditWorker: Promise<void> | null = null;
const AUDIT_INTERVAL = 300;
const AUDIT_QUEUE_LIMIT = 250;

function auditLookup(guildId: string, type: number, targetId: string, priority: boolean) {
  return new Promise<GuildAuditLogsEntry<number> | undefined>(resolve => {
    const request = { guildId, type, targetId, priority, resolve };
    if (priority) auditQueue.unshift(request);
    else auditQueue.push(request);
    // При экстремальном всплеске роняем самый старый НЕприоритетный запрос:
    // priority-запросы (kick/ban/timeout) никогда не выкидывают себя сами.
    if (auditQueue.length > AUDIT_QUEUE_LIMIT) {
      const dropAt = auditQueue.findIndex(entry => !entry.priority);
      if (dropAt !== -1) auditQueue.splice(dropAt, 1)[0]!.resolve(undefined);
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
      const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(error => { logger.warn("[AUDIT] Не удалось получить журнал аудита", guildId, error); return null; });
      time("audit.rest", performance.now() - started);
      count("audit.lookups");
      const entry = logs?.entries.find(x => x.targetId === targetId && Date.now() - x.createdTimestamp < 15_000);
      resolve(entry);
      if (auditQueue.length) await sleep(AUDIT_INTERVAL);
    }
  })().finally(() => { auditWorker = null; });
}

type AuditFindOptions = { priority?: boolean; retries?: number; retryDelay?: number };

// Audit log Discord распространяется с задержкой: lookup сразу после события
// может ничего не найти. Ретраим несколько раз вместо молчаливой потери
// исполнителя (для кика — всей записи). Массовым событиям уходит retries: 0:
// первых lookups хватает на исполнителя, остальные пишутся без него.
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
  // Тип, отсутствующий в сохранённой конфиге (новое событие), считается
  // включённым; явный false уважается.
  const allowed = settings.categories[type] ?? true;
  if (!allowed) return null;
  const lang = guildLang(guildId);
  const t = (k: Parameters<typeof logTr>[1], v?: Record<string, string | number>) => logTr(lang, k, v);
  const channelEvent = type.startsWith("channel_") || type === "message_purge";
  // «все» — сентинел для /clearwarn all: это не ID, а признак «вся гильдия».
  const subject = targetId === "все" ? t("targetAllSubject") : targetId === t("unknownExecutor") ? targetId : channelEvent ? `<#${targetId}> (ID: ${targetId})` : `<@${targetId}> (ID: ${targetId})`;
  const color = logColors[type] ?? (type.includes("delete") || type.includes("ban") || type.includes("kick") ? 0xed4245 : type.includes("join") || type.includes("create") ? 0x57f287 : 0x5865f2);
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(logTitleFor(lang, type))
    .addFields({ name: channelEvent ? t("fieldChannel") : t("fieldMember"), value: subject }, { name: t("fieldDetails"), value: details.slice(0, 1024) || t("detailsEmpty") }, { name: t("fieldTime"), value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true });
  if (moderatorId) embed.addFields({ name: t("fieldExecutor"), value: moderatorId === "automod" ? t("autoModWord") : `<@${moderatorId}>` });
  return embed;
}

export function logAction(input: LogActionInput) {
  const { guildId, type, targetId, ...rest } = input;
  const settings = settingsCache.get(guildId);
  const embed = buildEmbed(guildId, settings, { type, targetId, ...rest });
  if (embed) enqueueLog(settings.channelId!, embed);
}