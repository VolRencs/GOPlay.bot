import { AuditLogEvent, Events, type Client, type GuildBasedChannel, type Message } from "discord.js";
import { stmt } from "../../db/statements.ts";
import { forgetMessage, messageContent, rememberMessage } from "../../db/message-cache.ts";
import { guard } from "../../lib/errors.ts";
import { recordPunishmentAndOffer } from "../moderation/index.ts";
import { auditActor, auditFind, isBotAction, logAction } from "./index.ts";
import { guildLang, guildTr, trFor } from "../../lib/i18n/bot.ts";
import { logTr } from "../../lib/i18n/bot/logs.ts";
import { channelRef } from "../../lib/mentions.ts";
import { count } from "../../lib/perf.ts";
import { addMetric } from "../metrics.ts";
import { sendMemberEvent } from "../welcome.ts";
import { memberRoleDiff } from "../utils/members.ts";
import { invalidateReactionPanels } from "../config-cache.ts";
import { on } from "../events.ts";

function renderEmbed(embed: Message["embeds"][number], lang: "ru" | "en"): string {
  const lines: string[] = [];
  if (embed.title) lines.push(`**${embed.title}**`);
  if (embed.description) lines.push(embed.description);
  for (const field of embed.fields) lines.push(`${field.name}: ${field.value}`);
  if (embed.author?.name) lines.push(`${logTr(lang, "authorLabel")}: ${embed.author.name}`);
  if (embed.footer?.text) lines.push(`${logTr(lang, "footerLabel")}: ${embed.footer.text}`);
  if (embed.thumbnail?.url) lines.push(`${logTr(lang, "thumbnailLabel")}: ${embed.thumbnail.url}`);
  if (embed.image?.url) lines.push(`${logTr(lang, "imageLabel")}: ${embed.image.url}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function registerLoggingEvents(client: Client) {
  const recentBans = new Map<string, number>();
  const RECENT_BAN_TTL = 5 * 60_000;
  function sweepRecentBans() {
    const now = Date.now();
    for (const [key, at] of recentBans) if (now - at > RECENT_BAN_TTL) recentBans.delete(key);
  }

  on(client, Events.GuildMemberRemove, "MEMBER_LEAVE", member => {
    count("events.member_leave");
    addMetric(member.guild.id, "leaves");
    guard("GOODBYE", () => (member.partial ? member.fetch().then(full => sendMemberEvent(full, "goodbye")).catch(() => null) : sendMemberEvent(member, "goodbye")));
    if (isBotAction(member.guild.id, "member_kick", member.id)) return;
    const t = guildTr(logTr, member.guild.id);
    const banKey = `${member.guild.id}:${member.id}`;
    if (!recentBans.delete(banKey)) {
      logAction({ guildId: member.guild.id, type: "member_leave", targetId: member.id, details: t("leaveDetails") });
    }
    void auditFind(member.guild, AuditLogEvent.MemberKick, member.id, { priority: true, retries: 2, retryDelay: 800 }).then(entry => {
      if (entry) logAction({ guildId: member.guild.id, type: "member_kick", targetId: member.id, moderatorId: entry.executor?.id, details: t("reason", { reason: entry.reason ?? "—" }) });
    });
  });

  on(client, Events.GuildMemberUpdate, "MEMBER_UPDATE", async (oldMember, newMember) => {
    const fullNew = newMember.partial ? await newMember.fetch().catch(() => newMember) : newMember;
    const fullOld = oldMember?.partial ? await oldMember.fetch().catch(() => oldMember) : oldMember;
    const t = guildTr(logTr, fullNew.guild.id);
    const { added, removed } = memberRoleDiff(fullOld?.roles.cache.keys() ?? [], fullNew.roles.cache.keys(), fullNew.guild.id);
    const logRoles = (actor?: string) => logAction({ guildId: fullNew.guild.id, type: "member_roles", targetId: fullNew.id, moderatorId: actor, details: t("rolesPrefix") + [...added.map(id => t("roleGivenPart", { id })), ...removed.map(id => t("roleRemovedPart", { id }))].join(", ") });
    if (added.length || removed.length) void auditActor(fullNew.guild, AuditLogEvent.MemberRoleUpdate, fullNew.id, { retries: 0 }).then(logRoles, () => logRoles()).catch(() => null);
    if (!isBotAction(fullNew.guild.id, "member_timeout", fullNew.id) && fullOld?.communicationDisabledUntilTimestamp !== fullNew.communicationDisabledUntilTimestamp) {
      const isSet = Boolean(fullNew.communicationDisabledUntilTimestamp);
      const logTimeout = (actor?: string) => logAction({ guildId: fullNew.guild.id, type: "member_timeout", targetId: fullNew.id, moderatorId: actor, details: isSet ? t("timeoutSet") : t("timeoutCleared") });
      // Один REST-запрос на тайм-аут: тот же entry используется и для лога, и для апелляции.
      void auditFind(fullNew.guild, AuditLogEvent.MemberUpdate, fullNew.id, { priority: isSet, retries: 1, retryDelay: 800 }).then(entry => {
        logTimeout(entry?.executor?.id);
        if (isSet && entry) recordPunishmentAndOffer(client, { guildId: fullNew.guild.id, guildName: fullNew.guild.name, userId: fullNew.id, type: "timeout", reason: entry.reason ?? t("noReason"), moderatorId: entry.executor?.id ?? null });
      }, () => logTimeout());
    }
  });

  const editPending = new Map<string, { before: string; after: string; timer: ReturnType<typeof setTimeout> }>();
  const EDIT_DEBOUNCE_MS = 2_000;
  const code = (value: string) => `\`\`\`${value.replace(/```/g, "ˋˋˋ") || "—"}\`\`\``;
  on(client, Events.MessageUpdate, "MESSAGE_UPDATE", (oldMessage, newMessage) => {
    count("events.message_edit");
    if (!newMessage.guild || !newMessage.author || newMessage.author.bot) return;
    const key = `${newMessage.guildId}:${newMessage.channelId}:${newMessage.id}`;
    const after = newMessage.content ?? "";
    const before = messageContent(newMessage.id) ?? (oldMessage.partial ? "" : oldMessage.content);
    if (before === after) return;
    rememberMessage(newMessage.id, newMessage.guild.id, newMessage.channelId, after);
    const pending = editPending.get(key);
    if (pending) {
      clearTimeout(pending.timer);
      pending.after = after;
      pending.timer = setTimeout(() => { editPending.delete(key); guard("EDIT_LOG", () => fireEditLog(newMessage, pending.before, pending.after)); }, EDIT_DEBOUNCE_MS).unref();
      return;
    }
    editPending.set(key, { before, after, timer: setTimeout(() => { editPending.delete(key); guard("EDIT_LOG", () => fireEditLog(newMessage, before, after)); }, EDIT_DEBOUNCE_MS).unref() });
  });

  function fireEditLog(newMessage: Message, before: string, after: string) {
    const t = guildTr(logTr, newMessage.guild!.id);
    logAction({ guildId: newMessage.guild!.id, type: "message_edit", targetId: newMessage.author!.id, details: `${t("channelField", { channel: channelRef(newMessage.channelId) })}\n${t("beforeLabel")}:\n${code(before.slice(0, 450))}\n${t("afterLabel")}:\n${code(after.slice(0, 450))}` });
  }

  on(client, Events.MessageDelete, "MESSAGE_DELETE", async message => {
    count("events.message_delete");
    if (!message.guild) return;
    const deleted = stmt.panelDelete.run(message.guild.id, message.channelId, message.id);
    if (deleted.changes > 0) invalidateReactionPanels(message.guild.id);
    stmt.embedDetach.run(Date.now(), message.guild.id, message.channelId, message.id);
    const lang = guildLang(message.guild.id);
    const t = trFor(logTr, lang);
    const authorId = message.author?.id ?? t("unknownExecutor");
    const actor = await auditActor(message.guild, AuditLogEvent.MessageDelete, authorId, { retries: 0 });
    const content = (forgetMessage(message.id) ?? message.content ?? "").trim();
    let details = t("channelField", { channel: channelRef(message.channelId) });
    if (content) details += `\n${t("contentLabel", { content: content.slice(0, 500) })}`;
    const embeds = message.embeds.map(embed => renderEmbed(embed, lang)).filter(Boolean);
    if (embeds.length) details += `\n${t("embedsLabel")}\n${embeds.join("\n—\n").slice(0, 800)}`;
    logAction({ guildId: message.guild.id, type: "message_delete", targetId: authorId, moderatorId: actor, details });
  });

  on(client, Events.GuildBanAdd, "GUILD_BAN_ADD", ban => {
    recentBans.set(`${ban.guild.id}:${ban.user.id}`, Date.now());
    if (isBotAction(ban.guild.id, "member_ban", ban.user.id)) return;
    const t = guildTr(logTr, ban.guild.id);
    void auditFind(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id, { priority: true, retries: 1, retryDelay: 800 }).then(entry => {
      logAction({ guildId: ban.guild.id, type: "member_ban", targetId: ban.user.id, moderatorId: entry?.executor?.id, details: t("reason", { reason: entry?.reason ?? t("notSpecified") }) });
      recordPunishmentAndOffer(client, { guildId: ban.guild.id, guildName: ban.guild.name, userId: ban.user.id, type: "ban", reason: entry?.reason ?? t("noReason"), moderatorId: entry?.executor?.id ?? null });
    });
  });

  on(client, Events.GuildBanRemove, "GUILD_BAN_REMOVE", ban => {
    recentBans.delete(`${ban.guild.id}:${ban.user.id}`);
    const t = guildTr(logTr, ban.guild.id);
    void auditFind(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id, { priority: true, retries: 1, retryDelay: 800 }).then(entry => {
      logAction({ guildId: ban.guild.id, type: "member_unban", targetId: ban.user.id, moderatorId: entry?.executor?.id, details: t("reason", { reason: entry?.reason ?? t("notSpecified") }) });
    });
  });

  async function logChannelEvent(channel: GuildBasedChannel, type: AuditLogEvent, kind: "channel_create" | "channel_delete", key: "channelCreated" | "channelDeleted") {
    const actor = await auditActor(channel.guild, type, channel.id);
    const t = guildTr(logTr, channel.guild.id);
    logAction({ guildId: channel.guild.id, type: kind, targetId: channel.id, moderatorId: actor, details: t(key, { name: channel.name }) });
  }
  on(client, Events.ChannelCreate, "CHANNEL_LOG", async channel => { if ("guild" in channel) await logChannelEvent(channel, AuditLogEvent.ChannelCreate, "channel_create", "channelCreated"); });
  on(client, Events.ChannelDelete, "CHANNEL_LOG", async channel => { if ("guild" in channel) await logChannelEvent(channel, AuditLogEvent.ChannelDelete, "channel_delete", "channelDeleted"); });

  setInterval(sweepRecentBans, 60_000).unref();
}
