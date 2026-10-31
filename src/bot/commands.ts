import { ApplicationCommandOptionType, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { commandsTr, guildLang, trFor } from "../lib/i18n/bot.ts";
import { BRAND_COLOR } from "../lib/colors.ts";
import { roleRef, userRef } from "../lib/mentions.ts";
import { trModeration } from "../lib/i18n/bot/moderation.ts";
import { moderate } from "./moderation/index.ts";

const commandDescriptionsEn: Record<string, string> = {
  play: "Play music from YouTube in a voice channel",
  ping: "Show bot latency", help: "Show command list", user: "User info", server: "Server info",
  avatar: "Show user's avatar", ban: "Ban a user", kick: "Kick a user", timeout: "Timeout a user",
  untimeout: "Remove timeout", warn: "Warn a user", warnings: "Show warnings", clearwarn: "Clear warnings",
  purge: "Delete recent channel messages", slowmode: "Set channel slowmode", lock: "Lock channel", unlock: "Unlock channel",
  lvl: "Show a member's level", top: "Show the XP leaderboard",
};

export const commands = [
  { name: "play", description: "Включить музыку с YouTube в голосовом канале", options: [{ name: "link", description: "Ссылка YouTube (видео или плейлист)", type: ApplicationCommandOptionType.String, required: true }] },
  { name: "ping", description: "Показать задержку бота до Discord" },
  { name: "help", description: "Показать список команд и их описание" },
  { name: "user", description: "Информация о пользователе", options: [{ name: "user", description: "Кого посмотреть (по умолчанию — вы)", type: ApplicationCommandOptionType.User }] },
  { name: "server", description: "Информация о сервере" },
  { name: "avatar", description: "Показать аватар пользователя", options: [{ name: "user", description: "Чей аватар (по умолчанию — ваш)", type: ApplicationCommandOptionType.User }] },
  { name: "lvl", description: "Показать уровень участника", options: [{ name: "user", description: "Чей уровень (по умолчанию — вы)", type: ApplicationCommandOptionType.User }] },
  { name: "top", description: "Топ участников сервера по уровню" },
  { name: "ban", description: "Забанить пользователя", admin: true, options: [{ name: "user", description: "Пользователь", type: ApplicationCommandOptionType.User, required: true }, { name: "reason", description: "Причина", type: ApplicationCommandOptionType.String }] },
  { name: "kick", description: "Исключить пользователя с сервера", admin: true, options: [{ name: "user", description: "Пользователь", type: ApplicationCommandOptionType.User, required: true }, { name: "reason", description: "Причина", type: ApplicationCommandOptionType.String }] },
  { name: "timeout", description: "Выдать тайм-аут (заглушить) пользователю", admin: true, options: [{ name: "user", description: "Пользователь", type: ApplicationCommandOptionType.User, required: true }, { name: "minutes", description: "Минуты (по умолчанию 10)", type: ApplicationCommandOptionType.Integer, min_value: 1, max_value: 40320 }, { name: "reason", description: "Причина", type: ApplicationCommandOptionType.String }] },
  { name: "untimeout", description: "Снять тайм-аут с пользователя", admin: true, options: [{ name: "user", description: "Пользователь", type: ApplicationCommandOptionType.User, required: true }, { name: "reason", description: "Причина", type: ApplicationCommandOptionType.String }] },
  { name: "warn", description: "Выдать предупреждение пользователю", admin: true, options: [{ name: "user", description: "Пользователь", type: ApplicationCommandOptionType.User, required: true }, { name: "reason", description: "Причина", type: ApplicationCommandOptionType.String }] },
  { name: "warnings", description: "Показать предупреждения пользователя", admin: true, options: [{ name: "user", description: "Пользователь", type: ApplicationCommandOptionType.User, required: true }] },
  { name: "clearwarn", description: "Снять предупреждения: у пользователя или все на сервере", admin: true, options: [{ name: "user", description: "Пользователь, которому снять предупреждения", type: ApplicationCommandOptionType.User }, { name: "all", description: "Снять все предупреждения на сервере", type: ApplicationCommandOptionType.Boolean }] },
  { name: "purge", description: "Удалить последние сообщения канала", admin: true, options: [{ name: "amount", description: "Количество (1-100)", type: ApplicationCommandOptionType.Integer, required: true, min_value: 1, max_value: 100 }] },
  { name: "slowmode", description: "Установить медленный режим канала", admin: true, options: [{ name: "seconds", description: "Секунды между сообщениями (0 — выключить)", type: ApplicationCommandOptionType.Integer, required: true, min_value: 0, max_value: 21600 }] },
  { name: "lock", description: "Закрыть канал для отправки сообщений", admin: true },
  { name: "unlock", description: "Открыть канал для отправки сообщений", admin: true },
].map(({ admin, ...command }) => {
  return { ...command,
    ...(admin ? { default_member_permissions: String(PermissionFlagsBits.Administrator) } : {}),
    ...(commandDescriptionsEn[command.name] ? { description_localizations: { "en-US": commandDescriptionsEn[command.name], "en-GB": commandDescriptionsEn[command.name] } } : {}),
  };
});

// Команды модерации обрабатывает отдельный модуль: не-админ получает
// «недостаточно прав», а не «команда доступна только на сервере».
const moderationCommands = new Set(["ban", "kick", "timeout", "untimeout", "warn", "warnings", "clearwarn", "purge", "slowmode", "lock", "unlock"]);

type CommandHandler = (i: ChatInputCommandInteraction) => Promise<void>;

const handlers: Record<string, CommandHandler> = {
  ping: async i => { await i.reply(`🏓 ${i.client.ws.ping}ms`); },
  help: async i => {
    const cmdLang = guildLang(i.guildId ?? "");
    const tC = trFor(commandsTr, cmdLang);
    const lines = commands.map(c => tC("helpCommand", { name: c.name, desc: cmdLang === "en" ? commandDescriptionsEn[c.name] ?? c.description : c.description })).join("\n");
    await i.reply({ embeds: [new EmbedBuilder().setTitle(tC("helpTitle")).setDescription(lines)], flags: MessageFlags.Ephemeral });
  },
  user: async i => {
    const cmdLang = guildLang(i.guildId ?? "");
    const tC = trFor(commandsTr, cmdLang);
    const user = i.options.getUser("user") ?? i.user;
    const member = i.guild?.members.cache.get(user.id);
    const fields = [{ name: "ID", value: user.id, inline: true }, { name: tC("accountCreated"), value: `<t:${Math.floor(user.createdTimestamp / 1000)}:d>`, inline: true }];
    if (member) fields.push({ name: tC("joinedAt"), value: `<t:${Math.floor((member.joinedTimestamp ?? Date.now()) / 1000)}:d>`, inline: true }, { name: tC("rolesField"), value: member.roles.cache.filter(r => r.id !== i.guild!.id).map(r => roleRef(r.id)).slice(0, 25).join(" ") || "—", inline: false });
    await i.reply({ embeds: [new EmbedBuilder().setTitle(user.username).setThumbnail(user.displayAvatarURL({ size: 256 })).setColor(BRAND_COLOR).addFields(fields)] });
  },
  server: async i => {
    const cmdLang = guildLang(i.guildId ?? "");
    const tC = trFor(commandsTr, cmdLang);
    const guild = i.guild;
    if (!guild) { await i.reply({ content: trModeration(guildLang(i.guildId ?? ""), "notGuild"), flags: MessageFlags.Ephemeral }); return; }
    const embed = new EmbedBuilder().setTitle(guild.name).setThumbnail(guild.iconURL()).setColor(BRAND_COLOR)
      .addFields(
        { name: "ID", value: guild.id, inline: true },
        { name: tC("serverOwner"), value: userRef(guild.ownerId), inline: true },
        { name: tC("membersCount"), value: String(guild.memberCount), inline: true },
        { name: tC("createdAt"), value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:d>`, inline: true },
        { name: tC("channelsCount"), value: tC("channelsFormat", { t: String(guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size), v: String(guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size) }), inline: true },
        ...(guild.premiumSubscriptionCount ? [{ name: tC("boostsCount"), value: String(guild.premiumSubscriptionCount), inline: true }] : []),
      );
    await i.reply({ embeds: [embed] });
  },
  avatar: async i => {
    const user = i.options.getUser("user") ?? i.user;
    await i.reply({ embeds: [new EmbedBuilder().setTitle(user.username).setImage(user.displayAvatarURL({ size: 512 }))] });
  },
};

/** Обработка slash-команд; true — команда обработана. */
export async function handleChatCommand(i: ChatInputCommandInteraction): Promise<boolean> {
  const handler = handlers[i.commandName];
  if (handler) { await handler(i); return true; }
  if (moderationCommands.has(i.commandName)) { await moderate(i); return true; }
  return false;
}
