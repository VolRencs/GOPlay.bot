import { AuditLogEvent, ChannelType, Client, Events, GatewayIntentBits, Partials, REST, Routes, MessageFlags, PermissionFlagsBits, type Guild, type GuildBasedChannel, type Interaction, type Message } from "discord.js";
import { closeDatabase } from "../db/database.ts";
import { safeJson } from "../lib/json.ts";
import { automodActions, automodDefaultActions } from "../lib/automod.ts";
import { automodRulesFor } from "../lib/labels.ts";
import { DAY_MS, MAX_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS } from "../lib/constants.ts";
import { detect, isIgnored, pruneDetectors, burstMessages, shouldWarn, markWarned, clearWarned, isBurstKind, type Rule, type MessageData } from "./automod/detectors.ts";
import { purgeUserMessages, recordPunishmentAndOffer } from "./moderation/index.ts";
import { autoroleSettingsFor } from "../lib/autorole.ts";
import { stmt } from "../db/statements.ts";
import { forgetMessage, flushMessageCache, messageContent, rememberMessage } from "../db/message-cache.ts";
import { logger } from "../lib/logger.ts";
import { failInteraction, guard } from "../lib/errors.ts";
import { addMessage, addMetric, flushMetrics } from "./metrics.ts";
import { auditActor, auditFind, flushLogs, initLogging, isBotAction, logAction, markBotAction } from "./logging/index.ts";
import { cachedRules, invalidateReactionPanels, purgeConfigCaches, stopTimer, type CachedRule } from "./config-cache.ts";
import { registerTempChannels, cleanupTempChannels } from "./tempchannels/index.ts";
import { offerAppeal, registerAppeals } from "./appeals/index.ts";
import { registerEvents } from "./events/index.ts";
import { handleMusicCommand, registerMusic } from "./music/index.ts";
import { commands, handleChatCommand } from "./commands.ts";
import { applyPanelRoleSafe, handleReaction, panelNotifies } from "./self-roles.ts";
import { sendMemberEvent } from "./welcome.ts";
import { flushLevels, handleLevelCommand, registerLevels } from "./levels/index.ts";
import { destroyAllSessions, stopAndLeave } from "../lib/player/index.ts";
import { count, time } from "../lib/perf.ts";
import { startHeartbeat } from "./heartbeat.ts";
import { localeFromDiscord } from "../lib/i18n/core.ts";
import { automodTr, guildLang } from "../lib/i18n/bot.ts";
import { trModeration } from "../lib/i18n/bot/moderation.ts";
import { logTr } from "../lib/i18n/bot/logs.ts";
import { wipeGuildData } from "../lib/server-cleanup.ts";
import { deleteGuildFiles } from "../lib/uploads.ts";
import { fetchMember, memberRoleDiff } from "./utils/members.ts";
const automodRuleTitles = { ru: automodRulesFor("ru"), en: automodRulesFor("en") } as const;
const token = process.env.DISCORD_TOKEN; if (!token) throw new Error("DISCORD_TOKEN is required");
process.on("unhandledRejection", (reason) => { logger.error("[PROCESS] Unhandled rejection:", reason); });
process.on("uncaughtException", (error) => { logger.error("[PROCESS] Uncaught exception:", error); });
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent], partials: [Partials.Message, Partials.Reaction, Partials.Channel], rest: { timeout: 10_000 } });
initLogging(client);
function reportRoleHierarchy(guild: Guild) {
  const highest = guild.members.me?.roles.highest;
  if (!highest || highest.id === guild.id) {
    logger.warn(`[ROLES] У бота нет отдельной роли на сервере ${guild.id}; самовыдача ролей недоступна.`);
    return;
  }
  const blocked = guild.roles.cache.filter(role => !role.managed && role.id !== guild.id && role.position >= highest.position).size;
  if (blocked) logger.warn(`[ROLES] Роль бота «${highest.name}» на сервере ${guild.id} должна быть вручную перемещена выше ${blocked} ролей для их выдачи.`);
}
function onboardGuild(guild: Guild): void {
  const isNew = stmt.guildInsert.run(guild.id, guild.name, guild.iconURL(), Date.now()).changes > 0;
  if (isNew) stmt.guildLangUpdate.run(localeFromDiscord(guild.preferredLocale), guild.id);
  // Существующие строки не обновлялись с момента добавления бота — имя/иконка
  // в админке и DM-фолбэках оставались устаревшими после переименования сервера.
  else stmt.guildRefresh.run(guild.name, guild.iconURL(), Date.now(), guild.id);
  cachedRules(guild.id);
  reportRoleHierarchy(guild);
}
client.once(Events.ClientReady, async c => {
  startHeartbeat();
  logger.info("Бот готов:", c.user.username);
  try {
    await new REST().setToken(token).put(Routes.applicationCommands(c.user.id), { body: commands });
  } catch (error) {
    logger.error("Не удалось зарегистрировать slash-команды:", error);
  }
  // Ошибка одной гильдии не должна прерывать онбординг остальных и очистку
  // временных каналов.
  for (const guild of c.guilds.cache.values()) {
    try { onboardGuild(guild); } catch (error) { logger.error("[GUILD] Не удалось зарегистрировать гильдию", guild.id, error); }
  }
  logger.info("Зарегистрировано команд:", commands.length, "Гильдий:", c.guilds.cache.size);
  try { await cleanupTempChannels(c); } catch (error) { logger.error("[TEMP] Ошибка очистки временных каналов:", error); }
});
client.on(Events.GuildCreate, g => guard("GUILD_CREATE", () => {
  onboardGuild(g);
  logger.info("Бот добавлен на сервер:", g.id, g.name);
}));
client.on(Events.GuildMemberAdd, member => guard("MEMBER_JOIN", () => {
  count("events.member_join");
  addMetric(member.guild.id, "joins");
  // Ботам не здороваемся и не выдаём автороль; метрики joins/leaves остаются
  // симметричными (уход ботов тоже считается).
  if (!member.user.bot) {
    guard("WELCOME", () => sendMemberEvent(member, "welcome"));
    const autorole = autoroleSettingsFor(member.guild.id);
    const autoroleRoleId = autorole.roleId;
    if (autorole.enabled && autoroleRoleId) {
      guard("AUTOROLE", async () => {
        const role = member.guild.roles.cache.get(autoroleRoleId) ?? await member.guild.roles.fetch(autoroleRoleId).catch(() => null);
        if (!role || role.managed || !role.editable) return;
        await member.roles.add(role).catch(error => logger.warn("[AUTOROLE] Не удалось выдать роль", member.guild.id, autoroleRoleId, error));
      });
    }
  }
  logAction({ guildId: member.guild.id, type: "member_join", targetId: member.id, details: logTr(guildLang(member.guild.id), "joinDetails") });
}));
client.on(Events.GuildMemberRemove, member => {
  count("events.member_leave");
  addMetric(member.guild.id, "leaves");
  guard("GOODBYE", () => (member.partial ? member.fetch().then(full => sendMemberEvent(full, "goodbye")).catch(() => null) : sendMemberEvent(member, "goodbye")));
  if (isBotAction(member.guild.id, "member_kick", member.id)) return;
  const banKey = `${member.guild.id}:${member.id}`;
  if (!recentBans.delete(banKey)) {
    logAction({ guildId: member.guild.id, type: "member_leave", targetId: member.id, details: logTr(guildLang(member.guild.id), "leaveDetails") });
  }
  void auditFind(member.guild, AuditLogEvent.MemberKick, member.id, { priority: true, retries: 2, retryDelay: 800 }).then(entry => {
    if (entry) logAction({ guildId: member.guild.id, type: "member_kick", targetId: member.id, moderatorId: entry.executor?.id, details: logTr(guildLang(member.guild.id), "reason", { reason: entry.reason ?? "—" }) });
  });
});
const automodActionSet = new Set<string>(automodActions);
function automodDuration(guildId: string, userId: string, base: number, escalate: boolean) {
  if (!escalate) return base;
  const recent = stmt.automodRecent.get(guildId, userId, Date.now() - DAY_MS) as { count: number };
  return Math.min(MAX_TIMEOUT_SECONDS, base * 2 ** Math.min(4, recent.count));
}
async function enforceAutoMod(message: Message, row: CachedRule, threshold: Record<string, unknown>, data: MessageData) {
  const started = performance.now();
  const guild = message.guild!, author = message.author;
  let actions: string[] = []; const parsedActions = safeJson<unknown>(row.action_json, []); if (Array.isArray(parsedActions)) actions = parsedActions.filter((x): x is string => typeof x === "string" && automodActionSet.has(x));
  if (!actions.length) actions = [...automodDefaultActions];
  const lang = cachedRules(guild.id).lang;
  const ruleName = automodRuleTitles[lang][row.kind]?.title ?? row.kind, reason = automodTr(lang, "reason", { rule: ruleName });
  const rule: Rule = { kind: row.kind, threshold, window: row.window_seconds };
  const burstKind = isBurstKind(row.kind);
  // Окно наказания захватывается СИНХРОННО, до первого await: иначе следующее
  // сообщение того же пользователя успевало бы пройти проверку и получить
  // второе наказание за то же окно.
  const firstInBurst = burstKind ? shouldWarn(rule, data) : true;
  if (burstKind && firstInBurst) markWarned(rule, data);
  // Сообщение в уже обработанном burst-окне: удаляем, но не выдаём наказание
  // повторно (timeout/kick/ban/warn — один раз на окно).
  const repeatBurst = burstKind && !firstInBurst;
  let burst: { id: string; channelId: string }[] = [];
  let deletedCount = 0;
  const applied: string[] = [];
  if (actions.includes("delete")) {
    burst = burstKind ? burstMessages(rule, data) : [];
    deletedCount = burst.length ? await deleteBurst(guild, burst) : await message.delete().then(() => 1, () => 0);
    if (deletedCount > 0) applied.push("delete");
  }
  const member = message.member;
  if (actions.includes("timeout") && member?.moderatable && !repeatBurst) {
    markBotAction(guild.id, "member_timeout", author.id);
    const base = Math.max(1, Math.min(MAX_TIMEOUT_SECONDS, Number(threshold.durationSeconds ?? DEFAULT_TIMEOUT_SECONDS)));
    if (await member.timeout(automodDuration(guild.id, author.id, base, Boolean(row.escalation)) * 1000, reason).then(() => true, () => false)) applied.push("timeout");
  }
  if (actions.includes("kick") && member?.kickable && !repeatBurst) { markBotAction(guild.id, "member_kick", author.id); if (await member.kick(reason).then(() => true, () => false)) applied.push("kick"); }
  if (actions.includes("ban") && member?.bannable && !repeatBurst) { markBotAction(guild.id, "member_ban", author.id); if (await member.ban({ reason }).then(() => true, () => false)) applied.push("ban"); }
  // Предупреждение видно в /warnings: строка type='warn', как у ручного /warn.
  let warnPunishmentId: number | null = null;
  if (actions.includes("warn") && !repeatBurst) {
    try {
      warnPunishmentId = Number(stmt.moderationInsert.run(guild.id, author.id, "automod", "warn", reason, Date.now()).lastInsertRowid);
      addMetric(guild.id, "moderation");
      applied.push("warn");
    } catch (error) { logger.warn("Не удалось записать предупреждение автомодерации", guild.id, error); }
  }
  // Строка type='automod' — для наказаний (timeout/kick/ban). Апелляция
  // предлагается при warn/timeout/ban: warn использует строку из /warnings,
  // kick необратим, delete — не наказание. Конкретное действие передаётся в
  // апелляцию (appealType), иначе reversalFor('automod') не снял бы ничего.
  let punishmentId: number | null = null;
  if (applied.some(action => action === "timeout" || action === "kick" || action === "ban")) {
    try {
      punishmentId = Number(stmt.moderationInsert.run(guild.id, author.id, null, "automod", row.kind, Date.now()).lastInsertRowid);
      addMetric(guild.id, "moderation");
    } catch (error) { logger.warn("Не удалось записать действие автомодерации", guild.id, error); }
  } else if (!applied.length) {
    logger.warn("[AUTOMOD] Ни одна мера не применилась", guild.id, row.kind, author.id, actions.join(","));
  }
  const banApplied = applied.includes("ban"), timeoutApplied = applied.includes("timeout");
  const appealType = banApplied ? "ban" : timeoutApplied ? "timeout" : applied.includes("warn") && warnPunishmentId !== null ? "warn" : null;
  if (appealType && (!burstKind || firstInBurst)) {
    const appealTarget = appealType === "warn" ? warnPunishmentId : punishmentId;
    if (appealTarget !== null) void offerAppeal(client, { punishmentId: appealTarget, guildId: guild.id, guildName: guild.name, userId: author.id, type: "automod", appealType, reason });
  }
  // Наказание не применилось (только delete или отказ Discord) — снимаем
  // claim окна, иначе следующее сообщение в окне уже не получит наказания.
  const punished = banApplied || timeoutApplied || applied.includes("kick") || applied.includes("warn");
  if (burstKind && !punished) clearWarned(rule, data);
  logAction({ guildId: guild.id, type: "automod", targetId: author.id, moderatorId: "automod", details: `${logTr(lang, "reason", { reason: ruleName })}\n${applied.length ? logTr(lang, "actionsLine", { list: applied.join(", ") }) : logTr(lang, "actionsFailedLine")}${deletedCount > 0 ? logTr(lang, "deletedFromBurst", { n: String(deletedCount) }) : ""}` });
  time("automod.enforce", performance.now() - started);
}
async function deleteBurst(guild: Guild, burst: { id: string; channelId: string }[]): Promise<number> {
  let deleted = 0;
  for (const [channelId, entries] of Map.groupBy(burst, entry => entry.channelId)) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement && !channel.isThread())) continue;
    const removed = await channel.bulkDelete(entries.map(entry => entry.id), true).catch(() => null);
    deleted += removed?.size ?? 0;
  }
  return deleted;
}
client.on(Events.MessageCreate, message => guard("MESSAGE_CREATE", async () => {
  count("events.message_create");
  if (!message.guild || message.author.bot) return;
  rememberMessage(message.id, message.guild.id, message.channel.id, message.content);
  addMessage(message.guild.id, message.channel.id, message.author.id);
  const cache = cachedRules(message.guild.id);
  if (!cache.protectedChannelId && cache.rules.length === 0) return;
  const member = message.member;
  const isAdmin = Boolean(member?.permissions.has(PermissionFlagsBits.Administrator)), isIgnoredMember = Boolean(member && cache.ignoredRoles.some(id => member.roles.cache.has(id)));
  if (cache.protectedChannelId === message.channel.id && !isAdmin && !isIgnoredMember) {
    await message.delete().catch(() => null);
    void purgeUserMessages(message.guild, message.author.id, 24);
    let banned = false;
    if (member?.bannable) {
      // Метку ставим ДО запроса: иначе gateway-событие успевает обогнать её и
      // в журнале появляется вторая запись о бане без причины.
      markBotAction(message.guild.id, "member_ban", message.author.id);
      banned = await member.ban({ reason: automodTr(guildLang(message.guild!.id), "protectedAdminOnly") }).then(() => true, () => false);
      if (!banned) logger.warn("[AUTOMOD] Бан в защищённом канале не применён", message.guild.id, message.author.id);
    }
    addMetric(message.guild.id, "moderation");
    logAction({ guildId: message.guild.id, type: "automod", targetId: message.author.id, moderatorId: "automod", details: automodTr(cache.lang, banned ? "protectedWiped" : "protectedWipedFailed") });
    return;
  }
  const data: MessageData = { id: message.id, guildId: message.guild.id, userId: message.author.id, channelId: message.channel.id, content: message.content, roleIds: member?.roles.cache.map(r => r.id) ?? [], mentionCount: message.mentions.users.size + message.mentions.roles.size, everyone: message.mentions.everyone, attachments: [...message.attachments.values()].map(a => ({ contentType: a.contentType })), at: Date.now() };
  const ignored = isIgnored(data, cache.ignoredRoles);
  if (ignored) return;
  // Каждое правило получает сообщение: счётчики окон не должны зависеть от
  // того, какое правило совпало раньше. Наказание применяется максимум одно.
  let matched: { row: CachedRule; threshold: Record<string, unknown> } | null = null;
  for (const row of cache.rules) {
    const threshold = row.threshold;
    if (threshold === null) continue;
    if (!detect({ kind: row.kind, threshold, window: row.window_seconds }, data)) continue;
    if (!matched) matched = { row, threshold };
  }
  if (matched) await enforceAutoMod(message, matched.row, matched.threshold, data);
}));
client.on(Events.InteractionCreate, i => guard("INTERACTION", () => routeInteraction(i)));
async function routeInteraction(i: Interaction) {
  try {
    // guildLang читает БД — внутри try, иначе ошибка оставляла бы интеракцию
    // без ответа (пользователь видит «думает…»).
    const cmdLang = guildLang(i.guildId ?? "");
    count("events.interaction");
    if (await handleMusicCommand(i)) return;
    if (await handleLevelCommand(i)) return;
    if (i.isChatInputCommand()) {
      // Неизвестная команда (её нельзя вызвать из Discord, но подстраховка):
      // отвечаем явно, а не уводим в обработчик модерации.
      if (!await handleChatCommand(i)) await i.reply({ content: trModeration(cmdLang, "genericError"), flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    if (i.isButton() && i.customId.startsWith("role:")) {
      const [, id, roleId] = i.customId.split(":");
      const member = i.guild ? await fetchMember(i.guild, i.user.id) : null;
      if (!id || !roleId || !member) return;
      const panelId = Number(id);
      // Ответ подтверждаем ДО выдачи роли: операция идёт через REST и может
      // занять больше 3 секунд, после которых Discord считает интеракцию
      // просроченной и сообщение не показывается вовсе.
      if (panelNotifies(i.guildId!, panelId)) await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
      else await i.deferUpdate().catch(() => null);
      const result = await applyPanelRoleSafe(i.guildId!, panelId, roleId, member);
      if (result.notify) await i.editReply({ content: result.text }).catch(() => null);
    }
    if (i.isStringSelectMenu() && i.customId.startsWith("roles:")) {
      const id = Number(i.customId.split(":")[1]);
      const member = i.guild ? await fetchMember(i.guild, i.user.id) : null;
      if (!member) return;
      if (panelNotifies(i.guildId!, id)) await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
      else await i.deferUpdate().catch(() => null);
      const results = await Promise.all(i.values.map(roleId =>
        applyPanelRoleSafe(i.guildId!, id, roleId, member),
      ));
      const messages = results.filter(r => r.notify).map(r => r.text);
      if (messages.length) await i.editReply({ content: messages.join("\n") }).catch(() => null);
    }
  } catch (error) {
    failInteraction("[INTERACTION] Обработка взаимодействия не удалась", i, error, automodTr(guildLang(i.guildId ?? ""), "genericError"), i.guildId ?? "dm");
  }
}
client.on(Events.MessageReactionAdd, (reaction, user) => guard("REACTION_ADD", () => handleReaction(reaction, user, false)));
client.on(Events.MessageReactionRemove, (reaction, user) => guard("REACTION_REMOVE", () => handleReaction(reaction, user, true)));
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
client.on(Events.GuildMemberUpdate, (oldMember, newMember) => guard("MEMBER_UPDATE", async () => {
  const fullNew = newMember.partial ? await newMember.fetch().catch(() => newMember) : newMember;
  const fullOld = oldMember?.partial ? await oldMember.fetch().catch(() => oldMember) : oldMember;
  const { added, removed } = memberRoleDiff(fullOld?.roles.cache.keys() ?? [], fullNew.roles.cache.keys(), fullNew.guild.id);
  const logRoles = (actor?: string) => logAction({ guildId: fullNew.guild.id, type: "member_roles", targetId: fullNew.id, moderatorId: actor, details: (() => { const l = guildLang(fullNew.guild.id); return logTr(l, "rolesPrefix") + [...added.map(id => logTr(l, "roleGivenPart", { id })), ...removed.map(id => logTr(l, "roleRemovedPart", { id }))].join(", "); })() });
  if (added.length || removed.length) void auditActor(fullNew.guild, AuditLogEvent.MemberRoleUpdate, fullNew.id, { retries: 0 }).then(logRoles, () => logRoles()).catch(() => null);
  if (!isBotAction(fullNew.guild.id, "member_timeout", fullNew.id) && fullOld?.communicationDisabledUntilTimestamp !== fullNew.communicationDisabledUntilTimestamp) {
    const isSet = Boolean(fullNew.communicationDisabledUntilTimestamp);
    const logTimeout = (actor?: string) => logAction({ guildId: fullNew.guild.id, type: "member_timeout", targetId: fullNew.id, moderatorId: actor, details: isSet ? logTr(guildLang(fullNew.guild.id), "timeoutSet") : logTr(guildLang(fullNew.guild.id), "timeoutCleared") });
    // Один REST-запрос на тайм-аут: тот же entry используется и для лога, и для апелляции.
    void auditFind(fullNew.guild, AuditLogEvent.MemberUpdate, fullNew.id, { priority: isSet, retries: 1, retryDelay: 800 }).then(entry => {
      logTimeout(entry?.executor?.id);
      if (isSet && entry) recordPunishmentAndOffer(client, { guildId: fullNew.guild.id, guildName: fullNew.guild.name, userId: fullNew.id, type: "timeout", reason: entry.reason ?? logTr(guildLang(fullNew.guild.id), "noReason"), moderatorId: entry.executor?.id ?? null });
    }, () => logTimeout());
  }
}));
const editPending = new Map<string, { before: string; after: string; timer: ReturnType<typeof setTimeout> }>();
const EDIT_DEBOUNCE_MS = 2_000;
const code = (value: string) => `\`\`\`${value.replace(/```/g, "ˋˋˋ") || "—"}\`\`\``;
client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
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
  logAction({ guildId: newMessage.guild!.id, type: "message_edit", targetId: newMessage.author!.id, details: (() => { const l = guildLang(newMessage.guild!.id); return `${logTr(l, "channelField", { channel: `<#${newMessage.channelId}>` })}\n${logTr(l, "beforeLabel")}:\n${code(before.slice(0, 450))}\n${logTr(l, "afterLabel")}:\n${code(after.slice(0, 450))}`; })() });
}
client.on(Events.MessageDelete, message => guard("MESSAGE_DELETE", async () => {
  count("events.message_delete");
  if (!message.guild) return;
  const deleted = stmt.panelDelete.run(message.guild.id, message.channelId, message.id);
  if (deleted.changes > 0) invalidateReactionPanels(message.guild.id);
  stmt.embedDetach.run(Date.now(), message.guild.id, message.channelId, message.id);
  const authorId = message.author?.id ?? logTr(guildLang(message.guild.id), "unknownExecutor");
  const actor = await auditActor(message.guild, AuditLogEvent.MessageDelete, authorId, { retries: 0 });
  const content = (forgetMessage(message.id) ?? message.content ?? "").trim();
  const lDel = guildLang(message.guild.id);
  let details = logTr(lDel, "channelField", { channel: `<#${message.channelId}>` });
  if (content) details += `\n${logTr(lDel, "contentLabel", { content: content.slice(0, 500) })}`;
  const embeds = message.embeds.map(embed => renderEmbed(embed, lDel)).filter(Boolean);
  if (embeds.length) details += `\n${logTr(lDel, "attachmentsLabel")}\n${embeds.join("\n—\n").slice(0, 800)}`;
  logAction({ guildId: message.guild.id, type: "message_delete", targetId: authorId, moderatorId: actor, details });
}));
const recentBans = new Map<string, number>();
const RECENT_BAN_TTL = 5 * 60_000;
function sweepRecentBans() {
  const now = Date.now();
  for (const [key, at] of recentBans) if (now - at > RECENT_BAN_TTL) recentBans.delete(key);
}
client.on(Events.GuildBanAdd, ban => {
  recentBans.set(`${ban.guild.id}:${ban.user.id}`, Date.now());
  if (isBotAction(ban.guild.id, "member_ban", ban.user.id)) return;
  void auditFind(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id, { priority: true, retries: 1, retryDelay: 800 }).then(entry => {
    logAction({ guildId: ban.guild.id, type: "member_ban", targetId: ban.user.id, moderatorId: entry?.executor?.id, details: logTr(guildLang(ban.guild.id), "reason", { reason: entry?.reason ?? logTr(guildLang(ban.guild.id), "notSpecified") }) });
    recordPunishmentAndOffer(client, { guildId: ban.guild.id, guildName: ban.guild.name, userId: ban.user.id, type: "ban", reason: entry?.reason ?? logTr(guildLang(ban.guild.id), "noReason"), moderatorId: entry?.executor?.id ?? null });
  });
});
client.on(Events.GuildBanRemove, ban => {
  recentBans.delete(`${ban.guild.id}:${ban.user.id}`);
  void auditFind(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id, { priority: true, retries: 1, retryDelay: 800 }).then(entry => {
    logAction({ guildId: ban.guild.id, type: "member_unban", targetId: ban.user.id, moderatorId: entry?.executor?.id, details: logTr(guildLang(ban.guild.id), "reason", { reason: entry?.reason ?? logTr(guildLang(ban.guild.id), "notSpecified") }) });
  });
});
async function logChannelEvent(channel: GuildBasedChannel, type: AuditLogEvent, kind: "channel_create" | "channel_delete", key: "channelCreated" | "channelDeleted") {
  const actor = await auditActor(channel.guild, type, channel.id);
  logAction({ guildId: channel.guild.id, type: kind, targetId: channel.id, moderatorId: actor, details: logTr(guildLang(channel.guild.id), key, { name: channel.name }) });
}
client.on(Events.ChannelCreate, channel => { if ("guild" in channel) guard("CHANNEL_LOG", () => logChannelEvent(channel, AuditLogEvent.ChannelCreate, "channel_create", "channelCreated")); });
client.on(Events.ChannelDelete, channel => { if ("guild" in channel) guard("CHANNEL_LOG", () => logChannelEvent(channel, AuditLogEvent.ChannelDelete, "channel_delete", "channelDeleted")); });
setInterval(pruneDetectors, 10 * 60_000).unref();
setInterval(sweepRecentBans, 60_000).unref();
registerTempChannels(client);
registerMusic(client);
registerLevels(client);
registerAppeals(client);
registerEvents(client);
client.on(Events.GuildDelete, guild => guard("GUILD_DELETE", () => {
  stopAndLeave(guild.id);
  purgeConfigCaches(guild.id);
  // Успех логируется только после реальной очистки: раньше падение wipe
  // (SQLITE_BUSY) оставляло данные гильдии, а лог утверждал обратное.
  let wiped = false;
  try { wipeGuildData(guild.id); wiped = true; }
  catch (error) { logger.error("[GUILD] Не удалось стереть данные сервера", guild.id, error); }
  guard("GUILD_FILES", () => deleteGuildFiles(guild.id));
  if (wiped) logger.info("[GUILD] Бот удалён с сервера, данные стёрты:", guild.id);
  else logger.warn("[GUILD] Бот удалён с сервера, данные остались в базе:", guild.id);
}));
async function shutdown() {
  stopTimer();
  flushMetrics();
  try { flushLevels(); } catch (error) { logger.warn("[LEVELS] Не удалось слить XP при остановке", error); }
  try { flushMessageCache(); } catch (error) { logger.warn("[CACHE] Не удалось слить буфер при остановке", error); }
  logger.info("Остановка бота...");
  // Логи дренируются перед выходом: очередь журнала иначе теряла бы самые
  // важные записи (модерация, удаления, входы).
  try { await flushLogs(); } catch (error) { logger.warn("[LOG] Не удалось слить логи при остановке", error); }
  destroyAllSessions();
  client.destroy();
  closeDatabase();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
client.login(token).catch(error => { logger.error("Не удалось подключиться к Discord:", error); process.exit(1); });