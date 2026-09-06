import { NextResponse } from "next/server.js";
import { withGuild, discordAccountOf } from "../../../../../../src/lib/guild-access.ts";
import { recordDashboardChange } from "../../../../../../src/lib/dashboard-audit.ts";
import { appealStatusMeta } from "../../../../../../src/lib/labels.ts";
import { guildLang } from "../../../../../../src/lib/i18n/bot.ts";
import { applyAppealReversal, notifyAppealStatus, reviewActions, reviewAppeal, type ReviewAction } from "../../../../../../src/lib/appeals.ts";

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string; appealId: string }> }) {
  const { guildId, appealId: rawAppealId } = await params;
  const appealId = Number(rawAppealId);
  const access = await withGuild(guildId);
  if (access instanceof Response) return access;
  if (!Number.isInteger(appealId) || appealId <= 0) return NextResponse.json({ error: "Некорректный номер апелляции." }, { status: 400 });
  const body = await request.json().catch(() => null) as { action?: unknown; comment?: unknown } | null;
  const rawAction = body?.action;
  if (typeof rawAction !== "string" || !reviewActions.includes(rawAction as ReviewAction)) return NextResponse.json({ error: "Некорректное действие." }, { status: 400 });
  const action = rawAction as ReviewAction;
  const comment = typeof body?.comment === "string" ? body.comment.trim().slice(0, 500) || null : null;
  const discordAccount = discordAccountOf(access.user.id);

  // Источник истины — переход в БД, он всегда первый. Discord-сайд-эффекты
  // не может отменить решение.
  const result = reviewAppeal({ guildId, appealId, action, reviewerId: discordAccount?.accountId ?? access.user.id, comment });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const { appeal, reversal } = result.value;

  const reversalResult = reversal ? await applyAppealReversal(guildLang(guildId), guildId, appeal.user_id, reversal) : null;
  const notified = await notifyAppealStatus(appeal, reversalResult);
  recordDashboardChange(guildId, access.user, "Апелляции", `Апелляция #${appeal.number}: статус «${appealStatusMeta[appeal.status]?.label ?? appeal.status}»${comment ? ` · комментарий: ${comment}` : ""}`);

  return NextResponse.json({ ok: true, appeal, reversal: reversalResult ? { ...reversalResult, failed: !reversalResult.ok } : null, notified });
}