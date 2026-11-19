import { NextResponse } from "next/server.js";
import { withTransaction } from "#db/database.ts";
import { stmt } from "#db/statements.ts";
import { guildRoute, jsonError, readJsonRecord } from "#lib/guild-access.ts";
import { cleanupTargetsM, type CleanupTarget } from "#lib/labels.ts";
import { recordDashboardChange } from "#lib/dashboard-audit.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";
import { runCleanupTarget } from "#lib/server-cleanup.ts";
import { cleanupUnusedUploads, eventUploadsDir } from "#lib/uploads.ts";

const targetKeys = cleanupTargetsM.map(target => target.key);
const targetLabel = (target: CleanupTarget) => cleanupTargetsM.find(t => t.key === target)!.label.ru;

export const POST = guildRoute(async (request, { guildId, user }) => {
  const body = await readJsonRecord(request);
  const target = body?.target as CleanupTarget | undefined;
  if (!target || !targetKeys.includes(target)) return jsonError("Некорректная цель очистки.");

  // The audit row and marker are written in the cleanup transaction so the bot
  // can drop only the pending buffers affected by this target.
  const removed = withTransaction(() => {
    const removed = runCleanupTarget(guildId, target);
    stmt.cleanupMarkerSet.run(guildId, target, Date.now());
    recordDashboardChange(guildId, user, AUDIT_SECTION.cleanup, `Очищено: ${targetLabel(target)}${target !== "audit" ? ` (${removed} записей)` : ""}`, true);
    return removed;
  });
  if (target === "events") {
    await cleanupUnusedUploads(eventUploadsDir(guildId), [], () => []);
  }
  return NextResponse.json({ ok: true, removed });
});
