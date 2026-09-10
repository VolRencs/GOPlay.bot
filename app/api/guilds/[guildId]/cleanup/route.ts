import { NextResponse } from "next/server.js";
import { guildRoute, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
import { cleanupTargetsM, type CleanupTarget } from "../../../../../src/lib/labels.ts";
import { recordDashboardChange } from "../../../../../src/lib/dashboard-audit.ts";
import { runCleanupTarget } from "../../../../../src/lib/server-cleanup.ts";

const targetKeys = cleanupTargetsM.map(target => target.key);
const targetLabel = (target: CleanupTarget) => cleanupTargetsM.find(t => t.key === target)!.label.ru;

export const POST = guildRoute(async (request, { guildId, user }) => {
  const body = await readJson<{ target?: unknown }>(request);
  const target = body?.target as CleanupTarget | undefined;
  if (!target || !targetKeys.includes(target)) return jsonError("Некорректная цель очистки.");

  const removed = runCleanupTarget(guildId, target);
  recordDashboardChange(guildId, user, "Очистка", `Очищено: ${targetLabel(target)}${target !== "audit" ? ` (${removed} записей)` : ""}`);
  return NextResponse.json({ ok: true, removed });
});