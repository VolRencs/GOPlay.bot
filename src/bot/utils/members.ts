import type { Guild, GuildMember } from "discord.js";

import { logger } from "../../lib/logger.ts";
import { isMissingDiscordResource } from "../../lib/errors.ts";

export const fetchMember = (guild: Guild, userId: string): Promise<GuildMember | null> =>
  guild.members.fetch(userId).catch((error: unknown) => {
    if (!isMissingDiscordResource(error, "member")) logger.warn("[MEMBERS] Не удалось получить участника", guild.id, userId, error);
    return null;
  });

export function memberRoleDiff(oldRoles: Iterable<string>, newRoles: Iterable<string>, guildId: string): { added: string[]; removed: string[] } {
  const before = new Set(oldRoles);
  const after = new Set(newRoles);
  return {
    added: [...after.difference(before)].filter(id => id !== guildId),
    removed: [...before.difference(after)].filter(id => id !== guildId),
  };
}
