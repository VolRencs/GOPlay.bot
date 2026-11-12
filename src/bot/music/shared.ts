import { PermissionFlagsBits, type APIInteractionGuildMember, type ButtonInteraction, type ChatInputCommandInteraction, type GuildMember, type StringSelectMenuInteraction, type VoiceBasedChannel } from "discord.js";
import { hasCurrent, queueSizeOf, stopAndLeave } from "../../lib/player/index.ts";
import { guildTr } from "../../lib/i18n/bot.ts";
import { musicTr } from "../../lib/i18n/bot/music.ts";

export const musicTFor = (guildId: string) => guildTr(musicTr, guildId);
export const NO_MENTIONS = { parse: [] } as const;

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

const pendingCommands = new Map<string, number>();

export function beginMusicCommand(guildId: string): void {
  pendingCommands.set(guildId, (pendingCommands.get(guildId) ?? 0) + 1);
}

export function endMusicCommand(guildId: string): void {
  const pending = (pendingCommands.get(guildId) ?? 1) - 1;
  if (pending > 0) pendingCommands.set(guildId, pending);
  else pendingCommands.delete(guildId);
}

export function leaveIfIdle(guildId: string | null): void {
  if (!guildId || hasCurrent(guildId) || queueSizeOf(guildId) > 0) return;
  if ((pendingCommands.get(guildId) ?? 0) > 1) return;
  stopAndLeave(guildId);
}
