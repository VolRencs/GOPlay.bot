import { EmbedBuilder, Events, MessageFlags, type Client, type Guild, type Interaction, type Message, type VoiceState } from "discord.js";
import { withTransaction } from "../../db/database.ts";
import { aliveGuildIds, isForeignKeyError, stmt } from "../db/statements.ts";
import { logger } from "../utils/logger.ts";
import { failInteraction, guard } from "../../lib/errors.ts";
import { ttlCacheSync } from "../../lib/cache.ts";
import { levelFromXp, levelProgress, type LevelReward, type LevelSettings } from "../../lib/levels.ts";
import { levelRewardsFor, levelSettingsFor } from "../../lib/levels-store.ts";
import { guildLang, guildTr } from "../../lib/i18n/bot.ts";
import { levelsTr } from "../../lib/i18n/bot/levels.ts";
import { resolveChannel } from "../logging/index.ts";

// XP-буфер: сообщения и голосовые минуты копятся в памяти и сливаются одной
// транзакцией раз в 5 c (как метрики и кэш сообщений) — MessageCreate не
// открывает запись в SQLite и не ловится на SQLITE_BUSY с дашбордом.
type PendingXp = { guildId: string; userId: string; xp: number; messages: number; voiceSeconds: number };
type LevelUp = { guildId: string; userId: string; level: number };

const FLUSH_INTERVAL = 5_000;
const VOICE_INTERVAL = 60_000;
const COOLDOWN_RETENTION_MS = 3_600_000;
const BAR_SIZE = 12;

const settingsCache = ttlCacheSync<string, LevelSettings>((guildId) => levelSettingsFor(guildId), 10_000);
const settingsFor = (guildId: string) => settingsCache.get(guildId);
const pending = new Map<string, PendingXp>();
const messageCooldowns = new Map<string, number>();
const voiceSessions = new Map<string, { guildId: string; userId: string; channelId: string }>();

const keyFor = (guildId: string, userId: string) => `${guildId}:${userId}`;

function addPending(guildId: string, userId: string, xp: number, messages: number, voiceSeconds: number): void {
  const key = keyFor(guildId, userId);
  const entry = pending.get(key);
  if (entry) { entry.xp += xp; entry.messages += messages; entry.voiceSeconds += voiceSeconds; }
  else pending.set(key, { guildId, userId, xp, messages, voiceSeconds });
}

/** Сливает буфер в БД и возвращает достигнутые уровни. Публичен для shutdown. */
export function flushLevels(): LevelUp[] {
  if (!pending.size) return [];
  const entries = [...pending.values()];
  pending.clear();
  const levelUps: LevelUp[] = [];
  try {
    withTransaction(() => {
      for (const entry of entries) {
        const settings = settingsFor(entry.guildId);
        const row = stmt.levelRow.get(entry.guildId, entry.userId) as { xp: number; level: number } | undefined;
        const newXp = (row?.xp ?? 0) + entry.xp;
        const newLevel = levelFromXp(newXp, settings.base_xp, settings.growth_percent);
        stmt.levelUpsert.run(entry.guildId, entry.userId, entry.xp, newLevel, entry.messages, entry.voiceSeconds, Date.now());
        if (newLevel > (row?.level ?? 0)) levelUps.push({ guildId: entry.guildId, userId: entry.userId, level: newLevel });
      }
    });
  } catch (error) {
    // FK-ошибка означает гильдию, которой уже нет в guilds: такие строки
    // выбрасываем, иначе флеш зациклится на них каждые 5 секунд.
    const missing = isForeignKeyError(error) ? missingGuilds(entries) : null;
    for (const entry of entries) if (!missing?.has(entry.guildId)) addPending(entry.guildId, entry.userId, entry.xp, entry.messages, entry.voiceSeconds);
    logger.warn("[LEVELS] Не удалось слить XP — повторю позже", error);
    return [];
  }
  return levelUps;
}

/** Гильдии из буфера, отсутствующие в guilds; null — проверить не удалось. */
function missingGuilds(entries: PendingXp[]): Set<string> | null {
  const alive = aliveGuildIds();
  if (!alive) return null;
  const missing = new Set<string>();
  for (const entry of entries) if (!alive.has(entry.guildId)) missing.add(entry.guildId);
  return missing;
}

function handleMessage(message: Message): void {
  if (!message.guild || message.author.bot) return;
  const settings = settingsFor(message.guild.id);
  if (!settings.enabled || settings.xp_per_message <= 0) return;
  if (settings.ignored_channel_ids.includes(message.channelId)) return;
  if (settings.ignored_role_ids.length && message.member?.roles.cache.some(role => settings.ignored_role_ids.includes(role.id))) return;
  if (message.content.trim().length < settings.min_message_length) return;
  const key = keyFor(message.guild.id, message.author.id);
  const now = Date.now();
  if (now - (messageCooldowns.get(key) ?? 0) < settings.message_cooldown_seconds * 1000) return;
  messageCooldowns.set(key, now);
  addPending(message.guild.id, message.author.id, settings.xp_per_message, 1, 0);
}

function handleVoiceState(oldState: VoiceState, newState: VoiceState): void {
  const guild = newState.guild ?? oldState.guild;
  const key = keyFor(guild.id, newState.id);
  if (!newState.channelId || newState.member?.user.bot) voiceSessions.delete(key);
  else voiceSessions.set(key, { guildId: guild.id, userId: newState.id, channelId: newState.channelId });
}

// Анти-фарм: XP капает только при 2+ людях в канале, не в AFK и не заглушённым.
function tickVoice(client: Client): void {
  const now = Date.now();
  for (const [key, at] of messageCooldowns) if (now - at > COOLDOWN_RETENTION_MS) messageCooldowns.delete(key);
  for (const [key, session] of voiceSessions) {
    const guild = client.guilds.cache.get(session.guildId);
    const member = guild?.members.cache.get(session.userId);
    const channel = guild?.channels.cache.get(session.channelId);
    if (!guild || !member || !channel?.isVoiceBased()) { voiceSessions.delete(key); continue; }
    if (guild.afkChannelId === channel.id) continue;
    if (member.voice.selfMute || member.voice.selfDeaf || member.voice.serverMute || member.voice.serverDeaf) continue;
    if (channel.members.filter(entry => !entry.user.bot).size < 2) continue;
    const settings = settingsFor(guild.id);
    if (!settings.enabled || settings.xp_per_voice_minute <= 0) continue;
    addPending(guild.id, session.userId, settings.xp_per_voice_minute, 0, 60);
  }
}

function targetReward(rewards: LevelReward[], level: number): LevelReward | undefined {
  let target: LevelReward | undefined;
  for (const reward of rewards) if (reward.level <= level && (!target || reward.level > target.level)) target = reward;
  return target;
}

// Одна роль на уровень: роль высшей достигнутой награды выдаётся, награды
// предыдущих уровней снимаются. Ошибки прав/иерархии не ломают level-up.
async function applyRewards(guild: Guild, userId: string, level: number, rewards: LevelReward[]): Promise<void> {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  const target = targetReward(rewards, level);
  for (const reward of rewards) {
    if (reward === target || reward.level > level || !member.roles.cache.has(reward.role_id)) continue;
    const role = guild.roles.cache.get(reward.role_id);
    if (role?.editable) await member.roles.remove(role).catch(error => logger.warn("[LEVELS] Не удалось снять роль награды", guild.id, error));
  }
  if (!target || member.roles.cache.has(target.role_id)) return;
  const role = guild.roles.cache.get(target.role_id);
  if (!role || !role.editable) { logger.warn("[LEVELS] Роль награды недоступна или выше роли бота", guild.id, target.role_id); return; }
  await member.roles.add(role).catch(error => logger.warn("[LEVELS] Не удалось выдать роль за уровень", guild.id, error));
}

async function notifyLevelUp(client: Client, guild: Guild, settings: LevelSettings, up: LevelUp): Promise<void> {
  if (settings.notify_mode === "off") return;
  const text = levelsTr(guildLang(guild.id), "levelUp", { user: `<@${up.userId}>`, level: String(up.level), server: guild.name });
  if (settings.notify_mode === "dm") {
    void client.users.send(up.userId, text).catch(() => null); // закрытые ЛС — не ошибка
    return;
  }
  if (settings.notify_mode === "channel" && settings.notify_channel_id) {
    const channel = await resolveChannel(settings.notify_channel_id);
    if (channel) await channel.send(text).catch(error => logger.warn("[LEVELS] Не удалось отправить уведомление об уровне", guild.id, error));
  }
}

async function applyLevelUps(client: Client, levelUps: LevelUp[]): Promise<void> {
  for (const up of levelUps) {
    const guild = client.guilds.cache.get(up.guildId);
    if (!guild) continue;
    const settings = settingsFor(guild.id);
    const rewards = levelRewardsFor(guild.id);
    if (rewards.length) guard("LEVELS:ROLES", () => applyRewards(guild, up.userId, up.level, rewards));
    await notifyLevelUp(client, guild, settings, up);
  }
}

function purgeLevelsGuild(guildId: string): void {
  const prefix = `${guildId}:`;
  for (const key of [...pending.keys()]) if (key.startsWith(prefix)) pending.delete(key);
  for (const key of [...voiceSessions.keys()]) if (key.startsWith(prefix)) voiceSessions.delete(key);
  for (const key of [...messageCooldowns.keys()]) if (key.startsWith(prefix)) messageCooldowns.delete(key);
  settingsCache.delete(guildId);
}

// Уже сидящие в голосовых каналах на момент старта: без сидинга их XP ждал бы
// следующего voice-события. GUILD_CREATE приносит voice_states, состав каналов
// уже доступен в кэше.
function seedVoiceSessions(client: Client): void {
  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased()) continue;
      for (const member of channel.members.values()) {
        if (!member.user.bot) voiceSessions.set(keyFor(guild.id, member.id), { guildId: guild.id, userId: member.id, channelId: channel.id });
      }
    }
  }
}

export function registerLevels(client: Client): void {
  client.on(Events.MessageCreate, message => guard("LEVELS", () => handleMessage(message)));
  client.on(Events.VoiceStateUpdate, (oldState, newState) => handleVoiceState(oldState, newState));
  client.on(Events.GuildDelete, guild => purgeLevelsGuild(guild.id));
  client.once(Events.ClientReady, () => seedVoiceSessions(client));
  setInterval(() => {
    const levelUps = flushLevels();
    if (levelUps.length) guard("LEVELS", () => applyLevelUps(client, levelUps));
  }, FLUSH_INTERVAL).unref();
  setInterval(() => tickVoice(client), VOICE_INTERVAL).unref();
}

function progressBar(current: number, needed: number): string {
  const filled = needed > 0 ? Math.min(BAR_SIZE, Math.max(0, Math.round((current / needed) * BAR_SIZE))) : BAR_SIZE;
  return "▰".repeat(filled) + "▱".repeat(BAR_SIZE - filled);
}

export async function handleLevelCommand(i: Interaction): Promise<boolean> {
  if (!i.isChatInputCommand() || (i.commandName !== "lvl" && i.commandName !== "top")) return false;
  const t = guildTr(levelsTr, i.guildId ?? "");
  try {
    if (!i.inGuild() || !i.guild) {
      await i.reply({ content: t("notGuild"), flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    const guild = i.guild;
    const settings = settingsFor(guild.id);
    if (!settings.enabled) {
      await i.reply({ content: t("disabled"), flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    if (i.commandName === "top") {
      const rows = stmt.levelTop.all(guild.id, 10) as { user_id: string; xp: number }[];
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(t("topTitle"));
      if (!rows.length) embed.setDescription(t("topEmpty"));
      else embed.setDescription(rows.map((row, index) => t("topLine", { rank: String(index + 1), user: `<@${row.user_id}>`, level: String(levelFromXp(row.xp, settings.base_xp, settings.growth_percent)), xp: String(row.xp) })).join("\n"));
      // Оба ответа видны только вызвавшему: топ и уровень — личная информация.
      await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return true;
    }
    const user = i.options.getUser("user") ?? i.user;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await i.reply({ content: t("memberNotFound"), flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    const row = stmt.levelRow.get(guild.id, member.id) as { xp: number; messages: number; voice_seconds: number } | undefined;
    const xp = row?.xp ?? 0;
    const progress = levelProgress(xp, settings.base_xp, settings.growth_percent);
    const rank = (stmt.levelRank.get(guild.id, xp) as { rank: number }).rank;
    const voiceSeconds = row?.voice_seconds ?? 0;
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(t("title", { user: member.displayName }))
      .addFields(
        { name: t("fieldLevel"), value: String(progress.level), inline: true },
        { name: t("fieldRank"), value: t("rankValue", { rank: String(rank) }), inline: true },
        { name: t("fieldTotalXp"), value: String(xp), inline: true },
        { name: t("fieldProgress"), value: progress.needed > 0 ? `${progressBar(progress.current, progress.needed)}\n${t("progressValue", { a: String(progress.current), b: String(progress.needed) })}` : t("maxLevelValue"), inline: false },
        { name: t("fieldMessages"), value: String(row?.messages ?? 0), inline: true },
        { name: t("fieldVoice"), value: t("voiceTime", { h: String(Math.floor(voiceSeconds / 3600)), m: String(Math.floor((voiceSeconds % 3600) / 60)) }), inline: true },
      );
    await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return true;
  } catch (error) {
    failInteraction("[LEVELS] Команда уровня не выполнена", i, error, t("genericError"), i.guildId ?? "dm");
    return true;
  }
}
