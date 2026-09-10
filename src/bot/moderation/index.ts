import { ChannelType, MessageFlags, type ChatInputCommandInteraction, type Client, type GuildMember, type TextChannel } from "discord.js";
import { stmt } from "../db/statements.ts";
import { logger } from "../utils/logger.ts";
import { addMetric } from "../metrics.ts";
import { logAction, markBotAction } from "../logging/index.ts";
import { offerAppeal } from "../appeals/index.ts";
import { clearWarns } from "../../lib/warns.ts";
import { DAY_MS } from "../../lib/constants.ts";
import { guildTr } from "../../lib/i18n/bot.ts";
import { trModeration } from "../../lib/i18n/bot/moderation.ts";
function canTarget(actor: GuildMember, target: GuildMember) { return actor.id !== target.id && actor.roles.highest.position > target.roles.highest.position && target.manageable; }
function record(guildId: string, userId: string, moderatorId: string | null, type: string, reason: string): number {
  const result = stmt.moderationInsert.run(guildId, userId, moderatorId, type, reason, Date.now());
  addMetric(guildId, "moderation");
  return Number(result.lastInsertRowid);
}
// Единая точка «произошло наказание»: строка moderation_actions + DM-оффер
// обработчики ручных банов/тайм-аутов, поэтому оффер везде одинаковый.
export function recordPunishmentAndOffer(client: Client, input: { guildId: string; guildName: string; userId: string; type: string; reason: string; moderatorId: string | null }) {
  const punishmentId = record(input.guildId, input.userId, input.moderatorId, input.type, input.reason);
  // untimeout — коррекция, kick необратим: оффер апелляции не нужен обоим.
  if (input.type === "untimeout" || input.type === "kick") return;
  void offerAppeal(client, { punishmentId, guildId: input.guildId, guildName: input.guildName, userId: input.userId, type: input.type, reason: input.reason });
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