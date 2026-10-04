import type { Guild, GuildMember } from "discord.js";

/** fetch участника с проглатыванием ошибок (нет прав/не найден → null). */
export const fetchMember = (guild: Guild, userId: string): Promise<GuildMember | null> =>
  guild.members.fetch(userId).catch(() => null);
