import { withTransaction } from "../db/database.ts";
import { stmt } from "../bot/db/statements.ts";

export function clearWarns(guildId: string, userId: string | null): number {
  return withTransaction(() => {
    const ids = stmt.warnIds.all(guildId, userId, userId) as { id: number }[];
    if (!ids.length) return 0;
    for (const { id } of ids) stmt.appealDeleteByPunishment.run(id);
    return Number(stmt.warnDelete.run(guildId, userId, userId).changes);
  });
}
