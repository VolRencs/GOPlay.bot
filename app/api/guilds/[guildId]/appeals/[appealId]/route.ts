import { NextResponse } from "next/server.js";
import { guildRoute, discordAccountOf, jsonError, readJson } from "../../../../../../src/lib/guild-access.ts";
import { recordDashboardChange } from "../../../../../../src/lib/dashboard-audit.ts";
import { appealStatusMeta } from "../../../../../../src/lib/labels.ts";
import { guildLang } from "../../../../../../src/lib/i18n/bot.ts";
import { applyAppealReversal, notifyAppealStatus, reviewActions, reviewAppeal, type ReviewAction } from "../../../../../../src/lib/appeals.ts";

export const POST = guildRoute<{ guildId: string; appealId: string }>(async (request, { guildId, user, params }) => {
  const appealId = Number(params.appealId);
  if (!Number.isInteger(appealId) || appealId <= 0) return jsonError("Некорректный номер апелляции.");
  const body = await readJson<{ action?: unknown; comment?: unknown }>(request);
  const rawAction = body?.action;
  if (typeof rawAction !== "string" || !reviewActions.includes(rawAction as ReviewAction)) return jsonError("Некорректное действие.");
  const action = rawAction as ReviewAction;
  const comment = typeof body?.comment === "string" ? body.comment.trim().slice(0, 500) || null : null;
  const discordAccount = discordAccountOf(user.id);

  // Источник истины — переход в БД, он всегда первый. Discord-сайд-эффекты
  // не может отменить решение.
  const result = reviewAppeal({ guildId, appealId, action, reviewerId: discordAccount?.accountId ?? user.id, comment });
  if (!result.ok) return jsonError(result.error, result.status);
  const { appeal, reversal } = result.value;

  const reversalResult = reversal ? await applyAppealReversal(guildLang(guildId), guildId, appeal.user_id, reversal) : null;
  const notified = await notifyAppealStatus(appeal, reversalResult);
  recordDashboardChange(guildId, user, "Апелляции", `Апелляция #${appeal.number}: статус «${appealStatusMeta[appeal.status]?.label ?? appeal.status}»${comment ? ` · комментарий: ${comment}` : ""}`);

  return NextResponse.json({ ok: true, appeal, reversal: reversalResult ? { ...reversalResult, failed: !reversalResult.ok } : null, notified });
});