import { withTransaction } from "../db/database.ts";
import { stmt } from "../bot/db/statements.ts";

export function clearWarns(guildId: string, userId: string | null): number {
  return withTransaction(() => {
    stmt.appealDeleteForWarns.run(guildId, userId, userId);
    return Number(stmt.warnDelete.run(guildId, userId, userId).changes);
  });
}
