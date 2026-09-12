import { ChannelType, MessageFlags, type ChatInputCommandInteraction, type Client, type Guild, type GuildMember, type NewsChannel, type TextChannel, type ThreadChannel } from "discord.js";
import { stmt } from "../db/statements.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "../utils/logger.ts";
import { addMetric } from "../metrics.ts";
import { time } from "../perf.ts";
import { logAction, markBotAction } from "../logging/index.ts";
import { offerAppeal } from "../appeals/index.ts";
import { appealPunishmentTypes } from "../../lib/appeals.ts";
import { clearWarns } from "../../lib/warns.ts";
import { DAY_MS } from "../../lib/constants.ts";
import { guildTr } from "../../lib/i18n/bot.ts";
import { trModeration } from "../../lib/i18n/bot/moderation.ts";
function canTarget(actor: GuildMember, target: GuildMember) { return actor.id !== target.id && actor.roles.highest.position > target.roles.highest.position && target.manageable; }
export function recordPunishmentAndOffer(client: Client, input: { guildId: string; guildName: string; userId: string; type: string; reason: string; moderatorId: string | null }) {
  const result = stmt.moderationInsert.run(input.guildId, input.userId, input.moderatorId, input.type, input.reason, Date.now());
  addMetric(input.guildId, "moderation");
  const punishmentId = Number(result.lastInsertRowid);
  // untimeout — коррекция, kick необратим: оффер апелляции не нужен обоим.
  if (input.type === "untimeout" || input.type === "kick") return;
  const appealType = appealPunishmentTypes.find(type => type === input.type);
  if (!appealType) return;
  void offerAppeal(client, { punishmentId, guildId: input.guildId, guildName: input.guildName, userId: input.userId, type: input.type, reason: input.reason, appealType });
}
// Логируем сразу с известным исполнителем (без audit-lookup) и помечаем,
// чтобы соответствующее gateway-событие не задублировало запись.
const logTypes: Record<string, string> = { ban: "member_ban", kick: "member_kick", timeout: "member_timeout", untimeout: "member_timeout" };
export async function moderate(i: ChatInputCommandInteraction) {
  const t = guildTr(trModeration, i.guildId ?? "");
  if (!i.guild || !i.member || !i.memberPermissions) return void i.reply({ content: t("notGuild"), flags: MessageFlags.Ephemeral }).catch(() => null);
  const command = i.commandName;
  // Отвечаем сразу: ниже REST-вызовы (фетч участника, бан, purge), которые
  // иначе держали бы интеракцию висящей и могли вылететь за 3-секундное окно.
  try {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (error) {
    logger.warn("Не удалось подтвердить команду модерации:", command, i.guildId, error);
    return;
  }
  try {
    if (command === "clearwarn") return clearWarnsCommand(i);
    if (["purge", "slowmode", "lock", "unlock"].includes(command)) return channelAction(i);
    const user = i.options.getUser("user", true);
    const target = await i.guild.members.fetch(user.id);
    if (!canTarget(i.member as GuildMember, target)) return i.editReply({ content: t("noPermsTarget") });
    const reason = i.options.getString("reason") ?? t("noReason");
    const logType = logTypes[command];
    if (logType) markBotAction(i.guildId!, logType, user.id);
    if (command === "ban") await target.ban({ reason });
    if (command === "kick") await target.kick(reason);
    if (command === "timeout") await target.timeout((i.options.getInteger("minutes") ?? 10) * 60_000, reason);
    if (command === "untimeout") await target.timeout(null, reason);
    if (command === "warn") {
      recordPunishmentAndOffer(i.client, { guildId: i.guildId!, guildName: i.guild.name, userId: user.id, type: "warn", reason, moderatorId: i.user.id });
      logAction({ guildId: i.guildId!, type: "member_warn", targetId: user.id, moderatorId: i.user.id, details: reason });
      return i.editReply(`✅ ${command}: ${user.tag}`);
    }
    if (command === "warnings") {
      const rows = stmt.warns.all(i.guildId, user.id) as { reason: string; created_at: number }[];
      return i.editReply({ content: rows.length ? rows.map((x, n) => `${n + 1}. ${x.reason} — <t:${Math.floor(x.created_at / 1000)}:d>`).join("\n") : t("warnListEmpty") });
    }
    recordPunishmentAndOffer(i.client, { guildId: i.guildId!, guildName: i.guild.name, userId: user.id, type: command, reason, moderatorId: i.user.id });
    if (logType) logAction({ guildId: i.guildId!, type: logType, targetId: user.id, moderatorId: i.user.id, details: command === "timeout" ? t("logTimeout", { min: String(i.options.getInteger("minutes") ?? 10), reason }) : t("logReason", { reason }) });
    return i.editReply(`✅ ${command}: ${user.tag}`);
  } catch (error) {
    logger.warn("Команда модерации не выполнена:", i.commandName, i.guildId, error);
    return void i.editReply({ content: t("noPermsGeneric") }).catch(() => null);
  }
}
async function clearWarnsCommand(i: ChatInputCommandInteraction) {
  const t = guildTr(trModeration, i.guildId ?? "");
  const user = i.options.getUser("user");
  const all = i.options.getBoolean("all") ?? false;
  if (!user && !all) return i.editReply({ content: t("clearwarnNeedTarget") });
  if (user && all) return i.editReply({ content: t("clearwarnExclusive") });
  if (user) {
    const target = await i.guild!.members.fetch(user.id);
    if (!canTarget(i.member as GuildMember, target)) return i.editReply({ content: t("noPermsTarget") });
  }
  const removed = clearWarns(i.guildId!, user?.id ?? null);
  if (!removed) return i.editReply({ content: user ? t("clearwarnNoneUser",{user:user.tag}) : t("warnListEmpty") });
  logAction({ guildId: i.guildId!, type: "member_warn_clear", targetId: user?.id ?? "все", moderatorId: i.user.id, details: t("logWarnClear", { n: String(removed) }) + (user ? t("targetUser", { user: user.tag }) : t("targetAll")) });
  return i.editReply({ content: t("clearwarnDone", { n: String(removed), target: user ? ` (${user.tag})` : t("targetAll") }) });
}
async function channelAction(i: ChatInputCommandInteraction) {
  const t = guildTr(trModeration, i.guildId ?? "");
  const channel = i.channel;
  if (!channel || channel.type !== ChannelType.GuildText) return i.editReply({ content: t("needTextChannel") });
  const text = channel as TextChannel;
  if (i.commandName === "purge") {
    const amount = i.options.getInteger("amount", true);
    const messages = await text.messages.fetch({ limit: amount });
    // bulkDelete не трогает сообщения старше 14 дней — тот же кап.
    const recent = messages.filter(m => Date.now() - m.createdTimestamp < 14 * DAY_MS);
    await text.bulkDelete(recent, true);
    logAction({ guildId: i.guildId!, type: "message_purge", targetId: text.id, moderatorId: i.user.id, details: t("logPurge", { n: String(recent.size) }) });
    return i.editReply({ content: t("purgeDone",{n:String(recent.size)}) });
  }
  if (i.commandName === "slowmode") await text.setRateLimitPerUser(i.options.getInteger("seconds", true));
  if (i.commandName === "lock") await text.permissionOverwrites.edit(i.guild!.roles.everyone, { SendMessages: false });
  if (i.commandName === "unlock") await text.permissionOverwrites.edit(i.guild!.roles.everyone, { SendMessages: null });
  return i.editReply(t("channelUpdated"));
}

// Массовая чистка сообщений автора (защищённый канал автомодерации): best-effort,
// ошибки не роняют вызывающий путь. Повторный вызов во время активной чистки
// расширяет дедлайн и не запускает второй проход.
const userPurges = new Map<string, { cutoff: number; requeue: boolean; promise: Promise<number> }>();

export function purgeUserMessages(guild: Guild, userId: string, hours: number): Promise<number> {
  const key = `${guild.id}:${userId}`;
  const cutoff = Date.now() - Math.min(hours * 3_600_000, 14 * DAY_MS);
  const active = userPurges.get(key);
  if (active) { active.cutoff = Math.min(active.cutoff, cutoff); active.requeue = true; return active.promise; }
  const state: { cutoff: number; requeue: boolean; promise: Promise<number> } = { cutoff, requeue: false, promise: Promise.resolve(0) };
  state.promise = (async () => {
    let deleted = 0;
    try {
      do {
        state.requeue = false;
        deleted += await purgeMessages(guild, userId, state.cutoff);
      } while (state.requeue);
    } catch (error) {
      logger.warn("[PURGE] Чистка сообщений прервана", guild.id, userId, error);
    } finally {
      userPurges.delete(key);
    }
    return deleted;
  })();
  userPurges.set(key, state);
  return state.promise;
}

async function purgeMessages(guild: Guild, userId: string, cutoff: number): Promise<number> {
  const started = performance.now();
  let deleted = 0;
  const channels = [...guild.channels.cache.values()].filter(
    channel => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement || channel.isThread(),
  ) as (TextChannel | NewsChannel | ThreadChannel)[];
  const CONCURRENCY = 5;
  for (let i = 0; i < channels.length; i += CONCURRENCY) {
    const chunk = channels.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async channel => {
        let deletedInChannel = 0;
        let before: string | undefined;
        for (let page = 0; page < 5; page++) {
          const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
          if (!batch || batch.size === 0) break;
          const oldest = batch.last()!;
          before = oldest.id;
          const targets = batch.filter(message => message.author.id === userId && message.createdTimestamp >= cutoff);
          if (targets.size > 0) {
            const removed = await channel.bulkDelete(targets, true).catch(() => null);
            deletedInChannel += removed?.size ?? 0;
          }
          if (oldest.createdTimestamp < cutoff) break;
        }
        return deletedInChannel;
      }),
    );
    for (const r of results) if (r.status === "fulfilled") deleted += r.value;
    if (i + CONCURRENCY < channels.length) await sleep(100);
  }
  time("purge.messages", performance.now() - started);
  return deleted;
}
