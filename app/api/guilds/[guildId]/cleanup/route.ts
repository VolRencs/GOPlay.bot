import { NextResponse } from "next/server.js";
import { guildRoute, jsonError, readJson } from "#lib/guild-access.ts";
import { cleanupTargetsM, type CleanupTarget } from "#lib/labels.ts";
import { recordDashboardChange } from "#lib/dashboard-audit.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";
import { runCleanupTarget } from "#lib/server-cleanup.ts";

const targetKeys = cleanupTargetsM.map(target => target.key);
const targetLabel = (target: CleanupTarget) => cleanupTargetsM.find(t => t.key === target)!.label.ru;

export const POST = guildRoute(async (request, { guildId, user }) => {
  const body = await readJson<{ target?: unknown }>(request);
  const target = body?.target as CleanupTarget | undefined;
  if (!target || !targetKeys.includes(target)) return jsonError("Некорректная цель очистки.");

  const removed = runCleanupTarget(guildId, target);
  recordDashboardChange(guildId, user, AUDIT_SECTION.cleanup, `Очищено: ${targetLabel(target)}${target !== "audit" ? ` (${removed} записей)` : ""}`);
  return NextResponse.json({ ok: true, removed });
});
