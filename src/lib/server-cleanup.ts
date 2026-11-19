import { withTransaction } from "../db/database.ts";
import { stmt } from "../db/statements.ts";
import { forgetGuildMessages } from "../db/message-cache.ts";
import { clearWarns } from "./warns.ts";
import { deleteEventsByGuild } from "./events.ts";
import { invalidateMusicSettings } from "./music-settings.ts";
import type { CleanupTarget } from "./labels.ts";

const statsDeletes = [stmt.cleanupStatsMetrics, stmt.cleanupStatsChannelStats, stmt.cleanupStatsUserStats, stmt.cleanupStatsHourlyMessages];

export function runCleanupTarget(guildId: string, target: CleanupTarget): number {
  if (target === "audit") return withTransaction(() => Number(stmt.cleanupAudit.run(guildId).changes));
  if (target === "appeals") return withTransaction(() => {
    const removed = Number(stmt.cleanupAppeals.run(guildId).changes);
    stmt.cleanupAppealCounter.run(guildId);
    return removed;
  });
  if (target === "warns") return clearWarns(guildId, null);
  if (target === "levels") return Number(stmt.cleanupLevels.run(guildId).changes);
  if (target === "events") return deleteEventsByGuild(guildId);
  return withTransaction(() => {
    let removed = 0;
    for (const del of statsDeletes) removed += Number(del.run(guildId).changes);
    return removed;
  });
}

export function wipeGuildData(guildId: string) {
  withTransaction(() => {
    // events, music_settings and message_cache have no guild FK; everything else cascades from guilds.
    deleteEventsByGuild(guildId);
    invalidateMusicSettings(guildId);
    stmt.cleanupMusic.run(guildId);
    forgetGuildMessages(guildId);
    stmt.cleanupMessageCache.run(guildId);
    stmt.cleanupGuild.run(guildId);
  });
}

export function pruneOldEvents(): void {
  stmt.eventsPrune.run(Date.now() - 90 * 86_400_000);
}
