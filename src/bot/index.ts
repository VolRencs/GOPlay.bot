import { Client, Events, GatewayIntentBits, Partials, REST, Routes, PermissionFlagsBits } from "discord.js";
import { logger } from "../lib/logger.ts";
import { guard } from "../lib/errors.ts";
import { count } from "../lib/perf.ts";
import { automodTr, guildTr } from "../lib/i18n/bot.ts";
import { logTr } from "../lib/i18n/bot/logs.ts";
import { detect, isIgnored, pruneDetectors, type MessageData } from "./automod/detectors.ts";
import { enforceAutoMod } from "./automod/enforce.ts";
import { purgeUserMessages, recordPunishmentAndOffer } from "./moderation/index.ts";
import { autoroleSettingsFor } from "../lib/autorole.ts";
import { parseActions } from "../lib/json.ts";
import { rememberMessage } from "../db/message-cache.ts";
import { addMessage, addMetric } from "./metrics.ts";
import { initLogging, logAction, markBotAction, messageLoggingEnabled } from "./logging/index.ts";
import { cachedRules, purgeConfigCaches } from "./config-cache.ts";
import { registerTempChannels, cleanupTempChannels } from "./tempchannels/index.ts";
import { registerAppeals } from "./appeals/index.ts";
import { registerEvents } from "./events/index.ts";
import { registerMusic } from "./music/index.ts";
import { commands } from "./commands.ts";
import { handleReaction } from "./self-roles.ts";
import { sendMemberEvent } from "./welcome.ts";
import { getWelcomeRenderer } from "../lib/welcome-render.ts";
import { registerLevels } from "./levels/index.ts";
import { stopAndLeave } from "../lib/player/index.ts";
import { startHeartbeat } from "./heartbeat.ts";
import { onboardGuild } from "./onboarding.ts";
import { registerLoggingEvents } from "./logging/events.ts";
import { registerInteractions } from "./interactions.ts";
import { shutdown } from "./shutdown.ts";
import { on, once } from "./events.ts";

const token = process.env.DISCORD_TOKEN; if (!token) throw new Error("DISCORD_TOKEN is required");
process.on("unhandledRejection", (reason) => { logger.error("[PROCESS] Unhandled rejection:", reason); });
process.on("uncaughtException", (error) => { logger.error("[PROCESS] Uncaught exception:", error); process.exit(1); });
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent], partials: [Partials.Message, Partials.Reaction, Partials.Channel, Partials.User, Partials.GuildMember], rest: { timeout: 10_000 } });
initLogging(client);
registerInteractions(client);
registerLoggingEvents(client);

once(client, Events.ClientReady, "CLIENT_READY", async c => {
  startHeartbeat();
  logger.info("Бот готов:", c.user.username);
  // Register guilds before any awaited startup work so early messages have a valid FK row.
  for (const guild of c.guilds.cache.values()) {
    try { onboardGuild(guild); } catch (error) { logger.error("[GUILD] Не удалось зарегистрировать гильдию", guild.id, error); }
  }
  try { await getWelcomeRenderer(); }
  catch (error) { logger.error("[WELCOME] Рендер картинок недоступен", error); }
  try {
    await new REST().setToken(token).put(Routes.applicationCommands(c.user.id), { body: commands });
  } catch (error) {
    logger.error("Не удалось зарегистрировать slash-команды:", error);
  }
  logger.info("Зарегистрировано команд:", commands.length, "Гильдий:", c.guilds.cache.size);
  try { await cleanupTempChannels(c); } catch (error) { logger.error("[TEMP] Ошибка очистки временных каналов:", error); }
});

on(client, Events.GuildCreate, "GUILD_CREATE", g => {
  onboardGuild(g);
  logger.info("Бот добавлен на сервер:", g.id, g.name);
});

on(client, Events.GuildMemberAdd, "MEMBER_JOIN", member => {
  count("events.member_join");
  if (!member.user.bot) {
    addMetric(member.guild.id, "joins");
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
    logAction({ guildId: member.guild.id, type: "member_join", targetId: member.id, details: guildTr(logTr, member.guild.id)("joinDetails") });
  }
});

on(client, Events.MessageCreate, "MESSAGE_CREATE", async message => {
  count("events.message_create");
  if (!message.guild || message.author.bot) return;
  if (messageLoggingEnabled(message.guild.id)) rememberMessage(message.id, message.guild.id, message.content);
  addMessage(message.guild.id, message.channel.id, message.author.id);
  const cache = cachedRules(message.guild.id);
  if (!cache.protectedChannelId && cache.rules.length === 0) return;
  const member = message.member;
  if (cache.protectedChannelId === message.channel.id
    && !member?.permissions.has(PermissionFlagsBits.Administrator)
    && !(member && cache.ignoredRoles.some(id => member.roles.cache.has(id)))) {
    await message.delete().catch(() => null);
    void purgeUserMessages(message.guild, message.author.id, 24);
    const t = guildTr(automodTr, message.guild.id);
    let banned = false;
    if (member?.bannable) {
      markBotAction(message.guild.id, "member_ban", message.author.id);
      banned = await member.ban({ reason: t("protectedAdminOnly") }).then(() => true, () => false);
      if (!banned) logger.warn("[AUTOMOD] Бан в защищённом канале не применён", message.guild.id, message.author.id);
      else recordPunishmentAndOffer(client, { guildId: message.guild.id, guildName: message.guild.name, userId: message.author.id, type: "ban", reason: t("protectedAdminOnly"), moderatorId: "automod" });
    }
    addMetric(message.guild.id, "moderation");
    logAction({ guildId: message.guild.id, type: "automod", targetId: message.author.id, moderatorId: "automod", details: t(banned ? "protectedWiped" : "protectedWipedFailed") });
    return;
  }
  const data: MessageData = { id: message.id, guildId: message.guild.id, userId: message.author.id, channelId: message.channel.id, content: message.content, roleIds: cache.ignoredRoles.length ? member?.roles.cache.map(r => r.id) ?? [] : [], mentionCount: message.mentions.users.size + message.mentions.roles.size, everyone: message.mentions.everyone, attachments: [...message.attachments.values()].map(a => ({ contentType: a.contentType })), at: Date.now() };
  const ignored = isIgnored(data, cache.ignoredRoles);
  if (ignored) return;
  const matches: { row: (typeof cache.rules)[number]; threshold: Record<string, unknown> }[] = [];
  for (const row of cache.rules) {
    const threshold = row.threshold;
    if (threshold === null) continue;
    if (detect({ kind: row.kind, threshold, window: row.window_seconds }, data)) matches.push({ row, threshold });
  }
  if (matches.length) {
    // A long-window spam rule must not shadow a ban/kick rule that also matched.
    const rank = (actions: string[]) => actions.includes("ban") ? 5 : actions.includes("kick") ? 4 : actions.includes("timeout") ? 3 : actions.includes("warn") ? 2 : 1;
    matches.sort((a, b) => rank(parseActions(b.row.action_json)) - rank(parseActions(a.row.action_json)));
    const matched = matches[0]!;
    await enforceAutoMod(client, message, matched.row, matched.threshold, data);
  }
});

on(client, Events.MessageReactionAdd, "REACTION_ADD", (reaction, user) => handleReaction(reaction, user, false));
on(client, Events.MessageReactionRemove, "REACTION_REMOVE", (reaction, user) => handleReaction(reaction, user, true));

setInterval(pruneDetectors, 10 * 60_000).unref();
registerTempChannels(client);
registerMusic(client);
registerLevels(client);
registerAppeals();
registerEvents(client);

on(client, Events.GuildDelete, "GUILD_DELETE", guild => {
  stopAndLeave(guild.id);
  purgeConfigCaches(guild.id);
  logger.info("[GUILD] Бот удалён с сервера, данные сохранены:", guild.id);
});

const stop = () => { shutdown(client).catch(error => { logger.error("Ошибка остановки:", error); process.exit(1); }); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
client.login(token).catch(error => { logger.error("Не удалось подключиться к Discord:", error); process.exit(1); });
