import { NextResponse } from "next/server.js";
import { guildRoute, discordAccountOf, jsonError, readJson } from "#lib/guild-access.ts";
import { recordDashboardChange } from "#lib/dashboard-audit.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";
import { appealStatusMeta } from "#lib/labels.ts";
import { guildLang } from "#lib/i18n/bot.ts";
import { applyAppealReversal, notifyAppealStatus, reviewActions, reviewAppeal } from "#lib/appeals.ts";

export const POST = guildRoute<{ guildId: string; appealId: string }>(async (request, { guildId, user, params }) => {
  const appealId = Number(params.appealId);
  if (!Number.isInteger(appealId) || appealId <= 0) return jsonError("Некорректный номер апелляции.");
  const body = await readJson<{ action?: unknown; comment?: unknown }>(request);
  const rawAction = body?.action;
  const action = typeof rawAction === "string" ? reviewActions.find(candidate => candidate === rawAction) : undefined;
  if (!action) return jsonError("Некорректное действие.");
  const comment = typeof body?.comment === "string" ? body.comment.trim().slice(0, 500) || null : null;
  const discordAccount = discordAccountOf(user.id);

  const result = reviewAppeal({ guildId, appealId, action, reviewerId: discordAccount?.accountId ?? user.id, comment });
  if (!result.ok) return jsonError(result.error, result.status);
  const { appeal, reversal, previousStatus } = result.value;

  const reversalResult = reversal ? await applyAppealReversal(guildLang(guildId), guildId, appeal.user_id, reversal) : null;
  const notified = await notifyAppealStatus(appeal, reversalResult);
  const statusLabel = (status: string) => appealStatusMeta[status]?.label ?? status;
  recordDashboardChange(guildId, user, AUDIT_SECTION.appeals, `Апелляция #${appeal.number}: «${statusLabel(previousStatus)}» → «${statusLabel(appeal.status)}»${comment ? ` · комментарий: ${comment}` : ""}`);

  return NextResponse.json({ ok: true, appeal, reversal: reversalResult ? { ...reversalResult, failed: !reversalResult.ok } : null, notified });
});
