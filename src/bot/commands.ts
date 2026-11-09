import { ApplicationCommandOptionType, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { commandsTr, guildLang, guildTr } from "../lib/i18n/bot.ts";
import { BRAND_COLOR } from "../lib/colors.ts";
import { roleRef, userRef } from "../lib/format.ts";
import { trModeration } from "../lib/i18n/bot/moderation.ts";
import { moderate } from "./moderation/index.ts";

type CommandOption = { name: string; description: string; type: ApplicationCommandOptionType; required?: boolean; min_value?: number; max_value?: number };
type CommandSpec = { name: string; description: string; descriptionEn: string; admin?: boolean; options?: CommandOption[] };

const COMMAND_SPECS: CommandSpec[] = [
  { name: "play", description: "Включить музыку с YouTube в голосовом канале", descriptionEn: "Play music from YouTube in a voice channel", options: [{ name: "link", description: "Ссылка YouTube (видео или плейлист)", type: ApplicationCommandOptionType.String, required: true }] },
  { name: "ping", description: "Показать задержку бота до Discord", descriptionEn: "Show bot latency" },
  { name: "help", description: "Показать список команд и их описание", descriptionEn: "Show command list" },
  { name: "user", description: "Информация о пользователе", descriptionEn: "User info", options: [{ name: "user", description: "Кого посмотреть (по умолчанию — вы)", type: ApplicationCommandOptionType.User }] },
  { name: "server", description: "Информация о сервере", descriptionEn: "Server info" },
  { name: "avatar", description: "Показать аватар пользователя", descriptionEn: "Show user's avatar", options: [{ name: "user", description: "Чей аватар (по умолчанию — ваш)", type: ApplicationCommandOptionType.User }] },
  { name: "lvl", description: "Показать уровень участника", descriptionEn: "Show a member's level", options: [{ name: "user", description: "Чей уровень (по умолчанию — вы)", type: ApplicationCommandOptionType.User }] },
  { name: "top", description: "Топ участников сервера по уровню", descriptionEn: "Show the XP leaderboard" },
  { name: "ban", description: "Забанить пользователя", descriptionEn: "Ban a user", admin: true, options: [{ name: "user", description: "Пользователь", type: ApplicationCommandOptionType.User, required: true }, { name: "reason", description: "Причина", type: ApplicationCommandOptionType.String }] },
  { name: "kick", description: "Исключить пользователя с сервера", descriptionEn: "Kick a user", admin: true, options: [{ name: "user", description: "Пользователь", type: ApplicationCommandOptionType.User, required: true }, { name: "reason", description: "Причина", type: ApplicationCommandOptionType.String }] },
  { name: "timeout", description: "Выдать тайм-аут (заглушить) пользователю", descriptionEn: "Timeout a user", admin: true, options: [{ name: "user", description: "Пользователь", type: ApplicationCommandOptionType.User, required: true }, { name: "minutes", description: "Минуты (по умолчанию 10)", type: ApplicationCommandOptionType.Integer, min_value: 1, max_value: 40320 }, { name: "reason", description: "Причина", type: ApplicationCommandOptionType.String }] },
  { name: "untimeout", description: "Снять тайм-аут с пользователя", descriptionEn: "Remove timeout", admin: true, options: [{ name: "user", description: "Пользователь", type: ApplicationCommandOptionType.User, required: true }, { name: "reason", description: "Причина", type: ApplicationCommandOptionType.String }] },
  { name: "warn", description: "Выдать предупреждение пользователю", descriptionEn: "Warn a user", admin: true, options: [{ name: "user", description: "Пользователь", type: ApplicationCommandOptionType.User, required: true }, { name: "reason", description: "Причина", type: ApplicationCommandOptionType.String }] },
  { name: "warnings", description: "Показать предупреждения пользователя", descriptionEn: "Show warnings", admin: true, options: [{ name: "user", description: "Пользователь", type: ApplicationCommandOptionType.User, required: true }] },
  { name: "clearwarn", description: "Снять предупреждения: у пользователя или все на сервере", descriptionEn: "Clear warnings", admin: true, options: [{ name: "user", description: "Пользователь, которому снять предупреждения", type: ApplicationCommandOptionType.User }, { name: "all", description: "Снять все предупреждения на сервере", type: ApplicationCommandOptionType.Boolean }] },
  { name: "purge", description: "Удалить последние сообщения канала", descriptionEn: "Delete recent channel messages", admin: true, options: [{ name: "amount", description: "Количество (1-100)", type: ApplicationCommandOptionType.Integer, required: true, min_value: 1, max_value: 100 }] },
  { name: "slowmode", description: "Установить медленный режим канала", descriptionEn: "Set channel slowmode", admin: true, options: [{ name: "seconds", description: "Секунды между сообщениями (0 — выключить)", type: ApplicationCommandOptionType.Integer, required: true, min_value: 0, max_value: 21600 }] },
  { name: "lock", description: "Закрыть канал для отправки сообщений", descriptionEn: "Lock channel", admin: true },
  { name: "unlock", description: "Открыть канал для отправки сообщений", descriptionEn: "Unlock channel", admin: true },
];

export const commands = COMMAND_SPECS.map(({ admin, descriptionEn, ...command }) => ({
  ...command,
  ...(admin ? { default_member_permissions: String(PermissionFlagsBits.Administrator) } : {}),
  description_localizations: { "en-US": descriptionEn, "en-GB": descriptionEn },
}));

const commandDescriptionsEn = Object.fromEntries(COMMAND_SPECS.map(spec => [spec.name, spec.descriptionEn]));
const moderationCommands = new Set(COMMAND_SPECS.filter(spec => spec.admin).map(spec => spec.name));

type CommandHandler = (i: ChatInputCommandInteraction) => Promise<void>;

const handlers: Record<string, CommandHandler> = {
  ping: async i => { await i.reply(`🏓 ${i.client.ws.ping}ms`); },
  help: async i => {
    const cmdLang = guildLang(i.guildId ?? "");
    const tC = guildTr(commandsTr, i.guildId ?? "");
    const lines = commands.map(c => tC("helpCommand", { name: c.name, desc: cmdLang === "en" ? commandDescriptionsEn[c.name] ?? c.description : c.description })).join("\n");
    await i.reply({ embeds: [new EmbedBuilder().setTitle(tC("helpTitle")).setDescription(lines)], flags: MessageFlags.Ephemeral });
  },
  user: async i => {
    const tC = guildTr(commandsTr, i.guildId ?? "");
    const user = i.options.getUser("user") ?? i.user;
    const member = i.guild?.members.cache.get(user.id);
    const fields = [{ name: "ID", value: user.id, inline: true }, { name: tC("accountCreated"), value: `<t:${Math.floor(user.createdTimestamp / 1000)}:d>`, inline: true }];
    if (member) fields.push({ name: tC("joinedAt"), value: `<t:${Math.floor((member.joinedTimestamp ?? Date.now()) / 1000)}:d>`, inline: true }, { name: tC("rolesField"), value: member.roles.cache.filter(r => r.id !== i.guild!.id).map(r => roleRef(r.id)).slice(0, 25).join(" ") || "—", inline: false });
    await i.reply({ embeds: [new EmbedBuilder().setTitle(user.username).setThumbnail(user.displayAvatarURL({ size: 256 })).setColor(BRAND_COLOR).addFields(fields)] });
  },
  server: async i => {
    const tC = guildTr(commandsTr, i.guildId ?? "");
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

export async function handleChatCommand(i: ChatInputCommandInteraction): Promise<boolean> {
  const handler = handlers[i.commandName];
  if (handler) { await handler(i); return true; }
  if (moderationCommands.has(i.commandName)) { await moderate(i); return true; }
  return false;
}
