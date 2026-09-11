import { AuditLogEvent, ChannelType, Client, EmbedBuilder, Events, GatewayIntentBits, Partials, REST, Routes, MessageFlags, PermissionFlagsBits, type Guild, type GuildMember, type Interaction, type Message, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from "discord.js";
import { closeDatabase, db } from "../db/database.ts";
import { safeJson } from "../lib/json.ts";
import { automodActions, automodDefaultActions } from "../lib/automod.ts";
import { automodRulesFor } from "../lib/labels.ts";
import { DAY_MS, MAX_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS } from "../lib/constants.ts";
import { detect, isIgnored, pruneDetectors, burstMessages, shouldWarn, markWarned, type Rule, type MessageData } from "./automod/detectors.ts";
import { moderate, purgeUserMessages, recordPunishmentAndOffer } from "./moderation/index.ts";
import { welcomeImage } from "./utils/welcome-image.ts";
import { renderWelcomeTemplate } from "../lib/welcome.ts";
import { stmt } from "./db/statements.ts";
import { forgetMessage, flushMessageCache, messageContent, rememberMessage } from "./db/message-cache.ts";
import { logger } from "./utils/logger.ts";
import { unrefInterval } from "./utils/timers.ts";
import { failInteraction, guard } from "../lib/errors.ts";
import { addMessage, addMetric, flushMetrics } from "./metrics.ts";
import { auditActor, auditFind, initLogging, isBotAction, logAction, markBotAction, resolveChannel } from "./logging/index.ts";
import { cachedRules, invalidateReactionPanels, purgeConfigCaches, reactionPanel, stopTimer, type CachedRule } from "./config-cache.ts";
import { registerTempChannels, cleanupTempChannels } from "./tempchannels/index.ts";
import { offerAppeal, registerAppeals } from "./appeals/index.ts";
import { registerEvents } from "./events/index.ts";
import { handleMusicCommand, registerMusic } from "./music/index.ts";
import { flushLevels, handleLevelCommand, registerLevels } from "./levels/index.ts";
import { destroyAllSessions, stopAndLeave } from "../lib/player/index.ts";
import { count, time } from "./perf.ts";
import { startHeartbeat } from "./heartbeat.ts";
import { localeFromDiscord } from "../lib/i18n/core.ts";
import { automodTr, commandsTr, guildLang } from "../lib/i18n/bot.ts";
import { trModeration } from "../lib/i18n/bot/moderation.ts";
import { logTr } from "../lib/i18n/bot/logs.ts";
import { wipeGuildData } from "../lib/server-cleanup.ts";
import { deleteGuildFiles } from "../lib/uploads.ts";
const langUpdate = db.prepare("UPDATE guilds SET lang=? WHERE id=?");
const guildRefresh = db.prepare("UPDATE guilds SET name=?,icon=?,updated_at=? WHERE id=?");
const automodRuleTitles = { ru: automodRulesFor("ru"), en: automodRulesFor("en") } as const;
const token = process.env.DISCORD_TOKEN; if (!token) throw new Error("DISCORD_TOKEN is required");
process.on("unhandledRejection", (reason) => { logger.error("[PROCESS] Unhandled rejection:", reason); });
process.on("uncaughtException", (error) => { logger.error("[PROCESS] Uncaught exception:", error); });
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent], partials: [Partials.Message, Partials.Reaction, Partials.Channel], rest: { timeout: 10_000 } });
initLogging(client);
const commandDescriptionsEn: Record<string, string> = {
  play: "Play music from YouTube in a voice channel",
  ping: "Show bot latency", help: "Show command list", user: "User info", server: "Server info",
  avatar: "Show user's avatar", ban: "Ban a user", kick: "Kick a user", timeout: "Timeout a user",
  untimeout: "Remove timeout", warn: "Warn a user", warnings: "Show warnings", clearwarn: "Clear warnings",
  purge: "Delete recent channel messages", slowmode: "Set channel slowmode", lock: "Lock channel", unlock: "Unlock channel",
  lvl: "Show a member's level", top: "Show the XP leaderboard",
};
const commands = [
  { name: "play", description: "Включить музыку с YouTube в голосовом канале", options: [{ name: "link", description: "Ссылка YouTube (видео или плейлист)", type: 3, required: true }] },
  { name: "ping", description: "Показать задержку бота до Discord" },
  { name: "help", description: "Показать список команд и их описание" },
  { name: "user", description: "Информация о пользователе", options: [{ name: "user", description: "Кого посмотреть (по умолчанию — вы)", type: 6 }] },
  { name: "server", description: "Информация о сервере" },
  { name: "avatar", description: "Показать аватар пользователя", options: [{ name: "user", description: "Чей аватар (по умолчанию — ваш)", type: 6 }] },
  { name: "lvl", description: "Показать уровень участника", options: [{ name: "user", description: "Чей уровень (по умолчанию — ваш)", type: 6 }] },
  { name: "top", description: "Топ участников сервера по уровню" },
  { name: "ban", description: "Забанить пользователя", admin: true, options: [{ name: "user", description: "Пользователь", type: 6, required: true }, { name: "reason", description: "Причина", type: 3 }] },
  { name: "kick", description: "Исключить пользователя с сервера", admin: true, options: [{ name: "user", description: "Пользователь", type: 6, required: true }, { name: "reason", description: "Причина", type: 3 }] },
  { name: "timeout", description: "Выдать тайм-аут (заглушить) пользователю", admin: true, options: [{ name: "user", description: "Пользователь", type: 6, required: true }, { name: "minutes", description: "Минуты (по умолчанию 10)", type: 4, min_value: 1, max_value: 40320 }, { name: "reason", description: "Причина", type: 3 }] },
  { name: "untimeout", description: "Снять тайм-аут с пользователя", admin: true, options: [{ name: "user", description: "Пользователь", type: 6, required: true }, { name: "reason", description: "Причина", type: 3 }] },
  { name: "warn", description: "Выдать предупреждение пользователю", admin: true, options: [{ name: "user", description: "Пользователь", type: 6, required: true }, { name: "reason", description: "Причина", type: 3 }] },
  { name: "warnings", description: "Показать предупреждения пользователя", admin: true, options: [{ name: "user", description: "Пользователь", type: 6, required: true }] },
  { name: "clearwarn", description: "Снять предупреждения: у пользователя или все на сервере", admin: true, options: [{ name: "user", description: "Пользователь, которому снять предупреждения", type: 6 }, { name: "all", description: "Снять все предупреждения на сервере", type: 5 }, { name: "reason", description: "Причина снятия", type: 3 }] },
  { name: "purge", description: "Удалить последние сообщения канала", admin: true, options: [{ name: "amount", description: "Количество (1-100)", type: 4, required: true, min_value: 1, max_value: 100 }] },
  { name: "slowmode", description: "Установить медленный режим канала", admin: true, options: [{ name: "seconds", description: "Секунды между сообщениями (0 — выключить)", type: 4, required: true, min_value: 0, max_value: 21600 }] },
  { name: "lock", description: "Закрыть канал для отправки сообщений", admin: true },
  { name: "unlock", description: "Открыть канал для отправки сообщений", admin: true },
].map(({ admin, ...command }) => {
  return { ...command,
    ...(admin ? { default_member_permissions: String(PermissionFlagsBits.Administrator) } : {}),
    ...(commandDescriptionsEn[command.name] ? { description_localizations: { "en-US": commandDescriptionsEn[command.name], "en-GB": commandDescriptionsEn[command.name] } } : {}),
  };
});
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
  if (isNew) langUpdate.run(localeFromDiscord(guild.preferredLocale), guild.id);
  // Существующие строки не обновлялись с момента добавления бота — имя/иконка
  // в админке и DM-фолбэках оставались устаревшими после переименования сервера.
  else guildRefresh.run(guild.name, guild.iconURL(), Date.now(), guild.id);
  cachedRules(guild.id);
  reportRoleHierarchy(guild);
}
client.once(Events.ClientReady, async c => {
  startHeartbeat();
  logger.info("Бот готов:", c.user.tag);
  try {
    await new REST().setToken(token).put(Routes.applicationCommands(c.user.id), { body: commands });
  } catch (error) {
    logger.error("Не удалось зарегистрировать slash-команды:", error);
  }
  for (const guild of c.guilds.cache.values()) onboardGuild(guild);
  logger.info("Зарегистрировано команд:", commands.length, "Гильдий:", c.guilds.cache.size);
  await cleanupTempChannels(c);
});
client.on(Events.GuildCreate, g => {
  onboardGuild(g);
  logger.info("Бот добавлен на сервер:", g.id, g.name);
});
type MemberEventSettings = {
  enabled: number; channel_id: string | null; message: string; image_enabled: number;
  background_path: string | null; image_config_json: string;
  goodbye_enabled: number; goodbye_channel_id: string | null; goodbye_message: string;
};
function memberTemplate(template: string, member: GuildMember) {
  const count = String(member.guild.memberCount);
  return renderWelcomeTemplate(template.replace(/\r\n?/g, "\n"), {
    user: `<@${member.id}>`,
    username: member.user.username,
    displayName: member.displayName,
    server: member.guild.name,
    count,
    memberCount: count,
    userId: member.id,
    userAvatar: member.user.displayAvatarURL(),
    serverIcon: member.guild.iconURL() ?? "",
  });
}
async function renderMemberImage(member: GuildMember, setting: MemberEventSettings, event: "welcome" | "goodbye") {
  const started = performance.now();
  try {
    return await welcomeImage({
      avatar: member.user.displayAvatarURL({ extension: "png" }),
      name: member.displayName,
      username: member.user.username,
      userId: member.id,
      server: member.guild.name,
      count: member.guild.memberCount,
      backgroundPath: setting.background_path,
      config: setting.image_config_json,
    });
  } catch (error) {
    logger.warn(`[${event}] Рендер изображения не удался`, member.guild.id, error);
    return null;
  } finally {
    time("welcome.render", performance.now() - started);
  }
}
async function sendMemberEvent(member: GuildMember, event: "welcome" | "goodbye") {
  const setting = stmt.welcomeSettings.get(member.guild.id) as MemberEventSettings | undefined;
  const welcome = event === "welcome";
  const enabled = welcome ? setting?.enabled : setting?.goodbye_enabled;
  const channelId = welcome ? setting?.channel_id : setting?.goodbye_channel_id;
  if (!setting || !enabled || !channelId) return;
  // Сначала резолвим канал: рендерить картинку для удалённого канала нечего.
  const channel = await resolveChannel(channelId);
  if (!channel) return;
  const content = memberTemplate(welcome ? setting.message : setting.goodbye_message, member).slice(0, 2000) || "\u200b";
  const image = welcome && setting.image_enabled ? await renderMemberImage(member, setting, event) : null;
  await channel.send({ content, ...(image ? { files: [{ attachment: image, name: "welcome.png" }] } : {}) }).catch(error => logger.warn(`[${event}] Доставка сообщения не удалась`, member.guild.id, error));
}
client.on(Events.GuildMemberAdd, member => {
  count("events.member_join");
  addMetric(member.guild.id, "joins");
  guard("WELCOME", () => sendMemberEvent(member, "welcome"));
  logAction({ guildId: member.guild.id, type: "member_join", targetId: member.id, details: logTr(guildLang(member.guild.id), "joinDetails") });
});
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
const roleLocks = new Map<string, Promise<void>>();
const ROLE_LOCK_TIMEOUT_MS = 10_000;
/** Таймаут с возможностью отмены: завершённый запрос не должен держать
 *  event loop и оставлять висящий таймер до 10 секунд. */
function lockTimeout(ms: number): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("role lock timeout")), ms);
    timer.unref();
  });
  return { promise, cancel: () => { if (timer) clearTimeout(timer); } };
}
async function withRoleLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = roleLocks.get(key) ?? Promise.resolve();
  let release: () => void;
  const cur = new Promise<void>((res) => (release = res));
  roleLocks.set(key, cur);
  // Зависший предшественник не должен держать очередь вечно.
  const wait = lockTimeout(ROLE_LOCK_TIMEOUT_MS);
  await Promise.race([prev, wait.promise]).catch(() => null);
  wait.cancel();
  const own = lockTimeout(ROLE_LOCK_TIMEOUT_MS);
  try {
    return await Promise.race([fn(), own.promise]);
  } finally {
    own.cancel();
    release!();
    if (roleLocks.get(key) === cur) roleLocks.delete(key);
  }
}
async function applyPanelRole(guildId: string, panelId: number, roleId: string, member: GuildMember) {
  return withRoleLock(`${guildId}:${member.id}`, async () => {
    const panel = stmt.panel.get(panelId, guildId) as { role_limit: number; role_mode: string; notify_enabled: number; notify_template: string } | undefined;
    const role = member.guild.roles.cache.get(roleId);
    if (!panel || !role || role.managed || !role.editable) return { text: automodTr(guildLang(guildId), "roleUnavailable"), notify: true };
    const has = member.roles.cache.has(roleId);
    const action = panel.role_mode === "add" ? "add" : panel.role_mode === "remove" ? "remove" : has ? "remove" : "add";
    if (action === "add" && !has && panel.role_limit > 0) {
      const ids = (stmt.panelOptionEmoji.all(panelId) as { role_id: string }[]).map(x => x.role_id);
      if (ids.filter(id => member.roles.cache.has(id)).length >= panel.role_limit) return { text: automodTr(guildLang(guildId), "roleLimitReached", { n: String(panel.role_limit) }), notify: true };
    }
    await member.roles[action](role);
    return { text: panel.notify_template.replace(/\{role\}/g, role.name), notify: Boolean(panel.notify_enabled) };
  });
}
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
  const burstKind = ["spam", "duplicate", "emoji"].includes(row.kind);
  // Сообщение в уже обработанном burst-окне: удаляем, но не выдаём наказание
  // повторно (timeout/kick/ban/warn — один раз на окно, см. markWarned ниже).
  const repeatBurst = burstKind && !shouldWarn(rule, data);
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
  if (appealType && (!burstKind || shouldWarn(rule, data))) {
    const appealTarget = appealType === "warn" ? warnPunishmentId : punishmentId;
    if (appealTarget !== null) void offerAppeal(client, { punishmentId: appealTarget, guildId: guild.id, guildName: guild.name, userId: author.id, type: "automod", appealType, reason });
  }
  // Наказание выдано — следующее сообщение burst-окна не наказывается повторно.
  // kick не входит в appealType, поэтому проверяем applied целиком.
  if (burstKind && (banApplied || timeoutApplied || applied.includes("kick") || applied.includes("warn"))) markWarned(rule, data);
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
client.on(Events.MessageCreate, async message => {
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
      banned = await member.ban({ reason: automodTr(guildLang(message.guild!.id), "protectedAdminOnly") }).then(() => true, () => false);
      if (banned) markBotAction(message.guild.id, "member_ban", message.author.id);
      else logger.warn("[AUTOMOD] Бан в защищённом канале не применён", message.guild.id, message.author.id);
    }
    addMetric(message.guild.id, "moderation");
    logAction({ guildId: message.guild.id, type: "automod", targetId: message.author.id, moderatorId: "automod", details: automodTr(cache.lang, banned ? "protectedWiped" : "protectedWipedFailed") });
    return;
  }
  const data: MessageData = { id: message.id, guildId: message.guild.id, userId: message.author.id, channelId: message.channel.id, content: message.content, roleIds: member?.roles.cache.map(r => r.id) ?? [], mentionCount: message.mentions.users.size + message.mentions.roles.size, everyone: message.mentions.everyone, attachments: [...message.attachments.values()].map(a => ({ contentType: a.contentType })), at: Date.now() };
  const ignored = isIgnored(data, cache.ignoredRoles);
  for (const row of cache.rules) {
    const threshold = row.threshold;
    if (threshold === null) continue;
    if (!ignored && detect({ kind: row.kind, threshold, window: row.window_seconds }, data)) {
      await enforceAutoMod(message, row, threshold, data);
      break;
    }
  }
});
client.on(Events.InteractionCreate, i => void routeInteraction(i));
async function routeInteraction(i: Interaction) {
  const cmdLang = guildLang(i.guildId ?? "");
  const tC = (k: Parameters<typeof commandsTr>[1], v?: Record<string, string | number>) => commandsTr(cmdLang, k, v);
  count("events.interaction");
  try {
    if (await handleMusicCommand(i)) return;
    if (await handleLevelCommand(i)) return;
    if (i.isChatInputCommand()) {
      if (i.commandName === "ping") {
        await i.reply(`🏓 ${client.ws.ping}ms`);
      } else if (i.commandName === "help") {
        await i.reply({ embeds: [new EmbedBuilder().setTitle(tC("helpTitle")).setDescription(commands.map(c => tC("helpCommand", { name: c.name, desc: cmdLang === "en" ? commandDescriptionsEn[c.name] ?? c.description : c.description })).join("\n"))], flags: MessageFlags.Ephemeral });
      } else if (i.commandName === "user") {
        const user = i.options.getUser("user") ?? i.user;
        const member = i.guild?.members.cache.get(user.id);
        const fields = [{ name: "ID", value: user.id, inline: true }, { name: tC("accountCreated"), value: `<t:${Math.floor(user.createdTimestamp / 1000)}:d>`, inline: true }];
        if (member) fields.push({ name: tC("joinedAt"), value: `<t:${Math.floor((member.joinedTimestamp ?? Date.now()) / 1000)}:d>`, inline: true }, { name: tC("rolesField"), value: member.roles.cache.filter(r => r.id !== i.guild!.id).map(r => `<@&${r.id}>`).slice(0, 25).join(" ") || "—", inline: false });
        await i.reply({ embeds: [new EmbedBuilder().setTitle(user.tag).setThumbnail(user.displayAvatarURL({ size: 256 })).setColor(0x5865f2).addFields(fields)] });
      } else if (i.commandName === "server") {
        const guild = i.guild;
        if (!guild) return i.reply({ content: trModeration(guildLang(i.guildId ?? ""), "notGuild"), flags: MessageFlags.Ephemeral });
        const embed = new EmbedBuilder().setTitle(guild.name).setThumbnail(guild.iconURL()).setColor(0x5865f2)
          .addFields(
            { name: "ID", value: guild.id, inline: true },
            { name: tC("serverOwner"), value: `<@${guild.ownerId}>`, inline: true },
            { name: tC("membersCount"), value: String(guild.memberCount), inline: true },
            { name: tC("createdAt"), value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:d>`, inline: true },
            { name: tC("channelsCount"), value: tC("channelsFormat", { t: String(guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size), v: String(guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size) }), inline: true },
            ...(guild.premiumSubscriptionCount ? [{ name: tC("boostsCount"), value: String(guild.premiumSubscriptionCount), inline: true }] : []),
          );
        await i.reply({ embeds: [embed] });
      } else if (i.commandName === "avatar") {
        const user = i.options.getUser("user") ?? i.user;
        await i.reply({ embeds: [new EmbedBuilder().setTitle(user.tag).setImage(user.displayAvatarURL({ size: 512 }))] });
      } else await moderate(i);
    }
    if (i.isButton() && i.customId.startsWith("role:")) {
      const [, id, roleId] = i.customId.split(":");
      const member = i.guild ? await resolveMember(i.guild, i.user.id) : null;
      if (!id || !roleId || !member) return;
      const result = await applyPanelRoleSafe(i.guildId!, Number(id), roleId, member);
      if (result.notify) await i.reply({ content: result.text, flags: MessageFlags.Ephemeral });
      else await i.deferUpdate();
    }
    if (i.isStringSelectMenu() && i.customId.startsWith("roles:")) {
      const id = Number(i.customId.split(":")[1]);
      const member = i.guild ? await resolveMember(i.guild, i.user.id) : null;
      if (!member) return;
      const results = await Promise.all(i.values.map(roleId =>
        applyPanelRoleSafe(i.guildId!, id, roleId, member),
      ));
      const messages = results.filter(r => r.notify).map(r => r.text);
      if (messages.length) await i.reply({ content: messages.join("\n"), flags: MessageFlags.Ephemeral });
      else await i.deferUpdate();
    }
  } catch (error) {
    failInteraction("[INTERACTION] Обработка взаимодействия не удалась", i, error, automodTr(guildLang(i.guildId ?? ""), "genericError"), i.guildId ?? "dm");
  }
}
function normalizeEmoji(value: string) { return value.replace(/\uFE0F/g, "").replace(/\u200D/g, ""); }
function samePanelEmoji(saved: string | null, name: string | null, identifier: string) { if (!saved) return normalizeEmoji(name ?? "") === "✅"; const custom = saved.match(/^<(?:a)?:[^:]+:(\d+)>$/); return custom ? identifier.endsWith(custom[1]!) : normalizeEmoji(saved) === normalizeEmoji(name ?? ""); }
function resolveMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  return guild.members.fetch(userId).catch(() => null);
}
function applyPanelRoleSafe(guildId: string, panelId: number, roleId: string, member: GuildMember): Promise<{ text: string; notify: boolean }> {
  return applyPanelRole(guildId, panelId, roleId, member).catch(() => ({ text: automodTr(guildLang(guildId), "roleUpdateFail"), notify: true }));
}
async function handleReaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, removing: boolean) {
  count("events.reaction");
  if (user.bot) return;
  const guildId = reaction.message.guildId;
  if (!guildId) return;
  const panel = reactionPanel(guildId, reaction.message.id);
  if (!panel) return;
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message?.guild) return;
  const option = panel.options.find(o => samePanelEmoji(o.emoji, reaction.emoji.name, reaction.emoji.identifier));
  if (!option || (removing && panel.role_mode === "add")) return;
  const member = await resolveMember(message.guild, user.id);
  if (!member) return;
  if (removing) {
    const role = member.guild.roles.cache.get(option.role_id);
    if (role?.editable && member.roles.cache.has(role.id)) await member.roles.remove(role).catch(() => null);
    return;
  }
  const result = await applyPanelRoleSafe(message.guild.id, panel.id, option.role_id, member);
  if (result.notify) await member.send(result.text).catch(() => null);
}
client.on(Events.MessageReactionAdd, (reaction, user) => void handleReaction(reaction, user, false));
client.on(Events.MessageReactionRemove, (reaction, user) => void handleReaction(reaction, user, true));
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
client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  const before = new Set(oldMember?.roles.cache.keys() ?? []), after = new Set(newMember.roles.cache.keys());
  const added = [...after].filter(id => !before.has(id) && id !== newMember.guild.id), removed = [...before].filter(id => !after.has(id) && id !== newMember.guild.id);
  const logRoles = (actor?: string) => logAction({ guildId: newMember.guild.id, type: "member_roles", targetId: newMember.id, moderatorId: actor, details: (() => { const l = guildLang(newMember.guild.id); return logTr(l, "rolesPrefix") + [...added.map(id => logTr(l, "roleGivenPart", { id })), ...removed.map(id => logTr(l, "roleRemovedPart", { id }))].join(", "); })() });
  if (added.length || removed.length) void auditActor(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id, { retries: 0 }).then(logRoles, () => logRoles());
  if (!isBotAction(newMember.guild.id, "member_timeout", newMember.id) && oldMember?.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
    const isSet = Boolean(newMember.communicationDisabledUntilTimestamp);
    const logTimeout = (actor?: string) => logAction({ guildId: newMember.guild.id, type: "member_timeout", targetId: newMember.id, moderatorId: actor, details: isSet ? logTr(guildLang(newMember.guild.id), "timeoutSet") : logTr(guildLang(newMember.guild.id), "timeoutCleared") });
    // Один REST-запрос на тайм-аут: тот же entry используется и для лога, и для апелляции.
    void auditFind(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id, { priority: isSet, retries: 1, retryDelay: 800 }).then(entry => {
      logTimeout(entry?.executor?.id);
      if (isSet && entry) recordPunishmentAndOffer(client, { guildId: newMember.guild.id, guildName: newMember.guild.name, userId: newMember.id, type: "timeout", reason: entry.reason ?? logTr(guildLang(newMember.guild.id), "noReason"), moderatorId: entry.executor?.id ?? null });
    }, () => logTimeout());
  }
});
const editPending = new Map<string, { before: string; after: string; timer: ReturnType<typeof setTimeout> }>();
const EDIT_DEBOUNCE_MS = 2_000;
const code = (value: string) => `\`\`\`${value.replace(/```/g, "ˋˋˋ") || "—"}\`\`\``;
client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
  count("events.message_edit");
  if (!newMessage.guild || !newMessage.author || newMessage.author.bot) return;
  const key = `${newMessage.guildId}:${newMessage.channelId}:${newMessage.id}`;
  const before = messageContent(newMessage.id) ?? (oldMessage.partial ? "" : oldMessage.content);
  if (before === newMessage.content) return;
  rememberMessage(newMessage.id, newMessage.guild.id, newMessage.channelId, newMessage.content ?? "");
  const pending = editPending.get(key);
  if (pending) {
    clearTimeout(pending.timer);
    pending.after = newMessage.content;
    pending.timer = setTimeout(() => { editPending.delete(key); fireEditLog(newMessage, pending.before, pending.after); }, EDIT_DEBOUNCE_MS);
    return;
  }
  editPending.set(key, { before, after: newMessage.content, timer: setTimeout(() => { editPending.delete(key); fireEditLog(newMessage, before, newMessage.content); }, EDIT_DEBOUNCE_MS) });
});
function fireEditLog(newMessage: Message, before: string, after: string) {
  logAction({ guildId: newMessage.guild!.id, type: "message_edit", targetId: newMessage.author!.id, details: (() => { const l = guildLang(newMessage.guild!.id); return `${logTr(l, "channelField", { channel: `<#${newMessage.channelId}>` })}\n${logTr(l, "beforeLabel")}:\n${code(before.slice(0, 450))}\n${logTr(l, "afterLabel")}:\n${code(after.slice(0, 450))}`; })() });
}
client.on(Events.MessageDelete, async message => {
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
});
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
client.on(Events.ChannelCreate, async channel => {
  if (!("guild" in channel)) return;
  const actor = await auditActor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
  logAction({ guildId: channel.guild.id, type: "channel_create", targetId: channel.id, moderatorId: actor, details: logTr(guildLang(channel.guild.id), "channelCreated", { name: channel.name }) });
});
client.on(Events.ChannelDelete, async channel => {
  if (!("guild" in channel)) return;
  const actor = await auditActor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
  logAction({ guildId: channel.guild.id, type: "channel_delete", targetId: channel.id, moderatorId: actor, details: logTr(guildLang(channel.guild.id), "channelDeleted", { name: channel.name }) });
});
unrefInterval(pruneDetectors, 10 * 60_000);
unrefInterval(sweepRecentBans, 60_000);
registerTempChannels(client);
registerMusic(client);
registerLevels(client);
registerAppeals(client);
registerEvents(client);
client.on(Events.GuildDelete, guild => {
  stopAndLeave(guild.id);
  purgeConfigCaches(guild.id);
  guard("GUILD_WIPE", () => wipeGuildData(guild.id));
  guard("GUILD_FILES", () => deleteGuildFiles(guild.id));
  logger.info("[GUILD] Бот удалён с сервера, данные стёрты:", guild.id);
});
function shutdown() {
  stopTimer();
  flushMetrics();
  try { flushLevels(); } catch (error) { logger.warn("[LEVELS] Не удалось слить XP при остановке", error); }
  try { flushMessageCache(); } catch (error) { logger.warn("[CACHE] Не удалось слить буфер при остановке", error); }
  logger.info("Остановка бота...");
  destroyAllSessions();
  client.destroy();
  closeDatabase();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
client.login(token).catch(error => { logger.error("Не удалось подключиться к Discord:", error); process.exit(1); });