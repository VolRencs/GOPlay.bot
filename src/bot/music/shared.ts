import { PermissionFlagsBits, type APIInteractionGuildMember, type ButtonInteraction, type ChatInputCommandInteraction, type GuildMember, type StringSelectMenuInteraction, type VoiceBasedChannel } from "discord.js";
import { hasCurrent, queueSizeOf, stopAndLeave } from "../../lib/player/index.ts";
import { guildTr } from "../../lib/i18n/bot.ts";
import { musicTr } from "../../lib/i18n/bot/music.ts";

export const musicTFor = (guildId: string) => guildTr(musicTr, guildId);

export function isAdminInteraction(i: ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction): boolean {
  return Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

export function memberHasAllowedRole(member: GuildMember | APIInteractionGuildMember, roles: string[]): boolean {
  return Array.isArray(member.roles) ? member.roles.some(id => roles.includes(id)) : member.roles.cache.some(role => roles.includes(role.id));
}

export function canConnectAndSpeak(channel: VoiceBasedChannel, me: GuildMember | null): { connect: boolean; speak: boolean } {
  const permissions = channel.permissionsFor(me ?? channel.guild.roles.everyone);
  return { connect: Boolean(permissions?.has(PermissionFlagsBits.Connect)), speak: Boolean(permissions?.has(PermissionFlagsBits.Speak)) };
}

export function leaveIfIdle(guildId: string | null): void {
  if (guildId && !hasCurrent(guildId) && queueSizeOf(guildId) === 0) stopAndLeave(guildId);
}
