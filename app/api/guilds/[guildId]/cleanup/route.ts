import { NextResponse } from "next/server.js";
import { withTransaction } from "#db/database.ts";
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

  // The audit row doubles as a cross-process cleanup marker: the bot checks it
  // inside its flush transaction so pending buffers cannot resurrect deleted rows.
  const removed = withTransaction(() => {
    const removed = runCleanupTarget(guildId, target);
    recordDashboardChange(guildId, user, AUDIT_SECTION.cleanup, `Очищено: ${targetLabel(target)}${target !== "audit" ? ` (${removed} записей)` : ""}`, true);
    return removed;
  });
  if (target === "events") {
    await cleanupUnusedUploads(eventUploadsDir(guildId), [], () => []);
  }
  return NextResponse.json({ ok: true, removed });
});
