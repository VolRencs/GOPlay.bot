import { NextResponse } from "next/server.js";
import { withGuild } from "../../../../../src/lib/guild-access.ts";
import { cleanupTargetsM, type CleanupTarget } from "../../../../../src/lib/labels.ts";
import { recordDashboardChange } from "../../../../../src/lib/dashboard-audit.ts";
import { runCleanupTarget } from "../../../../../src/lib/server-cleanup.ts";

const targetKeys = cleanupTargetsM.map(target => target.key);
const targetLabel = (target: CleanupTarget) => cleanupTargetsM.find(t => t.key === target)!.label.ru;

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await withGuild(guildId);
  if (access instanceof Response) return access;
  const body = await request.json().catch(() => null) as { target?: unknown } | null;
  const target = body?.target as CleanupTarget | undefined;
  if (!target || !targetKeys.includes(target)) return NextResponse.json({ error: "Некорректная цель очистки." }, { status: 400 });

  const removed = runCleanupTarget(guildId, target);
  recordDashboardChange(guildId, access.user, "Очистка", `Очищено: ${targetLabel(target)}${target !== "audit" ? ` (${removed} записей)` : ""}`);
  return NextResponse.json({ ok: true, removed });
}