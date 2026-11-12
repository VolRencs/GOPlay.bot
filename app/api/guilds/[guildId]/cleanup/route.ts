import { NextResponse } from "next/server.js";
import { guildRoute, jsonError, readJsonRecord } from "#lib/guild-access.ts";
import { cleanupTargetsM, type CleanupTarget } from "#lib/labels.ts";
import { recordDashboardChange } from "#lib/dashboard-audit.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";
import { runCleanupTarget } from "#lib/server-cleanup.ts";
import { cleanupUnusedUploads, eventUploadsDir } from "#lib/uploads.ts";
import { logger } from "#lib/logger.ts";

const targetKeys = cleanupTargetsM.map(target => target.key);
const targetLabel = (target: CleanupTarget) => cleanupTargetsM.find(t => t.key === target)!.label.ru;

export const POST = guildRoute(async (request, { guildId, user }) => {
  const body = await readJsonRecord(request);
  const target = body?.target as CleanupTarget | undefined;
  if (!target || !targetKeys.includes(target)) return jsonError("Некорректная цель очистки.");

  const removed = runCleanupTarget(guildId, target);
  if (target === "events") {
    await cleanupUnusedUploads(eventUploadsDir(guildId), [], () => []).catch(error => logger.warn("[CLEANUP] Не удалось удалить файлы событий", guildId, error));
  }
  recordDashboardChange(guildId, user, AUDIT_SECTION.cleanup, `Очищено: ${targetLabel(target)}${target !== "audit" ? ` (${removed} записей)` : ""}`);
  return NextResponse.json({ ok: true, removed });
});
