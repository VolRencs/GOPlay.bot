import type { Guild, GuildMember } from "discord.js";

/** fetch участника с проглатыванием ошибок (нет прав/не найден → null). */
export const fetchMember = (guild: Guild, userId: string): Promise<GuildMember | null> =>
  guild.members.fetch(userId).catch(() => null);

/** Разница ролей между двумя снимками; @everyone (guildId) исключается. */
export function memberRoleDiff(oldRoles: Iterable<string>, newRoles: Iterable<string>, guildId: string): { added: string[]; removed: string[] } {
  const before = new Set(oldRoles);
  const after = new Set(newRoles);
  return {
    added: [...after.difference(before)].filter(id => id !== guildId),
    removed: [...before.difference(after)].filter(id => id !== guildId),
  };
}
