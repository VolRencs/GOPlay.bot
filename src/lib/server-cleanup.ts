import { withTransaction } from "../db/database.ts";
import { stmt } from "../db/statements.ts";
import { forgetGuildMessages } from "../db/message-cache.ts";
import { clearWarns } from "./warns.ts";
import { deleteEventsByGuild } from "./events.ts";
import { invalidateMusicSettings } from "./music-settings.ts";
import type { CleanupTarget } from "./labels.ts";

const statsDeletes = [stmt.cleanupStatsMetrics, stmt.cleanupStatsChannelStats, stmt.cleanupStatsUserStats, stmt.cleanupStatsHourlyMessages];

const WIPE_TARGETS: CleanupTarget[] = ["audit", "appeals", "warns", "stats", "events", "music", "levels"];

export function runCleanupTarget(guildId: string, target: CleanupTarget): number {
  if (target === "audit") return withTransaction(() => Number(stmt.cleanupAudit.run(guildId).changes));
  if (target === "appeals") return withTransaction(() => {
    const removed = Number(stmt.cleanupAppeals.run(guildId).changes);
    stmt.cleanupAppealCounter.run(guildId);
    return removed;
  });
  if (target === "warns") return clearWarns(guildId, null);
  if (target === "music") { invalidateMusicSettings(guildId); return Number(stmt.cleanupMusic.run(guildId).changes); }
  if (target === "levels") return Number(stmt.cleanupLevels.run(guildId).changes);
  if (target === "events") return deleteEventsByGuild(guildId);
  return withTransaction(() => {
    let removed = 0;
    for (const del of statsDeletes) removed += Number(del.run(guildId).changes);
    return removed;
  });
}

function purgeMessageCache(guildId: string) {
  forgetGuildMessages(guildId);
  stmt.cleanupMessageCache.run(guildId);
}

export function wipeGuildData(guildId: string) {
  withTransaction(() => {
    for (const target of WIPE_TARGETS) runCleanupTarget(guildId, target);
    purgeMessageCache(guildId);
    stmt.cleanupGuild.run(guildId);
  });
}

export function pruneOldEvents(): number {
  return Number(stmt.eventsPrune.run(Date.now() - 90 * 86_400_000).changes);
}
