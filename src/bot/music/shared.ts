import { PermissionFlagsBits, type APIInteractionGuildMember, type ButtonInteraction, type ChatInputCommandInteraction, type GuildMember, type StringSelectMenuInteraction } from "discord.js";
import { hasCurrent, queueSizeOf, stopAndLeave } from "../../lib/player/index.ts";
import { guildTr } from "../../lib/i18n/bot.ts";
import { musicTr } from "../../lib/i18n/bot/music.ts";

/** Переводчик музыкальных сообщений для гильдии. */
export const musicTFor = (guildId: string) => guildTr(musicTr, guildId);

export function isAdminInteraction(i: ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction): boolean {
  return Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

export function memberHasAllowedRole(member: GuildMember | APIInteractionGuildMember, roles: string[]): boolean {
  return Array.isArray(member.roles) ? member.roles.some(id => roles.includes(id)) : member.roles.cache.some(role => roles.includes(role.id));
}

/** Отказ после раннего connectToVoice не должен оставлять бота в канале без
 *  трека и без панели: уходим, если ничего не играет и очередь пуста. */
export function leaveIfIdle(guildId: string | null): void {
  if (guildId && !hasCurrent(guildId) && queueSizeOf(guildId) === 0) stopAndLeave(guildId);
}
