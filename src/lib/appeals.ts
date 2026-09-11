import { type SQLInputValue } from "node:sqlite";
import { db, withTransaction } from "../db/database.ts";
import { stmt } from "../bot/db/statements.ts";
import { discordFetch, sendDiscordDM } from "./guild-access.ts";
import { punishmentLabel } from "./labels.ts";
import type { Locale } from "./i18n/core.ts";
import { guildLang } from "./i18n/bot.ts";
import { trAppeals } from "./i18n/bot/appeals.ts";

export const appealStatuses = ["pending", "reviewing", "approved", "rejected", "closed", "declined"] as const;
export type AppealStatus = (typeof appealStatuses)[number];
export const reviewActions = ["reviewing", "approved", "rejected", "closed"] as const;
export type ReviewAction = (typeof reviewActions)[number];

// Типы наказаний, по которым возможна реальная отмена (см. reversalFor).
export const appealPunishmentTypes = ["warn", "timeout", "ban"] as const;
export type AppealPunishmentType = (typeof appealPunishmentTypes)[number];

type Punishment = { id: number; guild_id: string; user_id: string; type: string; reason: string | null; created_at: number };
// id — глобальный PK, number — локальная для гильдии нумерация (1,2,3...),
// берётся из guilds.appeal_counter.
type Appeal = { id: number; number: number; guild_id: string; user_id: string; punishment_id: number; type: string; reason: string; moderator_comment: string | null; status: AppealStatus; created_at: number; updated_at: number; reviewed_by: string | null; reviewed_at: number | null };
export type AppealView = Appeal & { punishment_reason: string | null; punishment_created_at: number };
export type AppealsListGet = { appeals: AppealView[] };

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
type ReviewResultValue = { ok: true; value: ReviewResult } | { ok: false; error: string; status: number };

const punishmentStmt = db.prepare("SELECT id,guild_id,user_id,type,reason,created_at FROM moderation_actions WHERE id=?");
const byIdStmt = db.prepare("SELECT * FROM appeals WHERE id=? AND guild_id=?");
const existingStmt = db.prepare("SELECT id,number,status FROM appeals WHERE punishment_id=?");
const insertStmt = db.prepare("INSERT INTO appeals(guild_id,user_id,punishment_id,type,reason,status,number,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)");
const updateStmt = db.prepare("UPDATE appeals SET status=?,moderator_comment=?,updated_at=?,reviewed_by=?,reviewed_at=? WHERE id=? AND guild_id=? AND status IN ('pending','reviewing')");
// Счётчик на гильдию: инкремент в той же транзакции, что и insert — серверы не
// делят последовательность, номера непрерывны. UNIQUE (guild_id, number)
// страхует от гонок выделения.
const nextNumberStmt = db.prepare("UPDATE guilds SET appeal_counter = appeal_counter + 1 WHERE id = ? RETURNING appeal_counter");

function getPunishment(punishmentId: number): Punishment | undefined {
  return punishmentStmt.get(punishmentId) as Punishment | undefined;
}

function nextAppealNumber(guildId: string): number {
  // Гильдия гарантирована FK-проверкой наказания: RETURNING всегда вернёт строку.
  return (nextNumberStmt.get(guildId) as { appeal_counter: number }).appeal_counter;
}

// Любая строка апелляции — включая отклонённую — навсегда блокирует новую
// по тому же наказанию: «Отказаться» в оффере в ЛС закрывает возможность.
function existingError(lang: Locale, existing: { id: number; number: number; status: AppealStatus } | undefined) {
  if (!existing) return trAppeals(lang, "createFail");
  if (existing.status === "declined") return trAppeals(lang, "alreadyDeclined");
  return trAppeals(lang, "duplicateShort", { n: String(existing.number) });
}

function insertAppeal(guildId: string, userId: string, punishmentId: number, type: string, reason: string, status: AppealStatus): Appeal {
  const at = Date.now();
  return withTransaction(() => {
    const number = nextAppealNumber(guildId);
    const result = insertStmt.run(guildId, userId, punishmentId, type, reason, status, number, at, at);
    return byIdStmt.get(Number(result.lastInsertRowid), guildId) as Appeal;
  });
}

// `type` — конкретное наказание для автомода: запись moderation_actions хранит
// type='automod', а отмена зависит от реального действия (timeout/ban/warn).
export function createAppeal(input: { guildId: string; userId: string; punishmentId: number; reason: string; type?: AppealPunishmentType | undefined }): Result<Appeal> {
  const lang = guildLang(input.guildId);
  const punishment = getPunishment(input.punishmentId);
  if (!punishment || punishment.guild_id !== input.guildId) return { ok: false, error: trAppeals(lang, "notFound") };
  if (punishment.user_id !== input.userId) return { ok: false, error: trAppeals(lang, "notYours") };
  const reason = input.reason.trim();
  if (reason.length < 10) return { ok: false, error: trAppeals(lang, "reasonTooShort") };
  if (reason.length > 4000) return { ok: false, error: trAppeals(lang, "reasonTooLong") };
  const existing = existingStmt.get(input.punishmentId) as { id: number; number: number; status: AppealStatus } | undefined;
  if (existing) return { ok: false, error: existingError(lang, existing) };
  try {
    return { ok: true as const, value: insertAppeal(input.guildId, input.userId, input.punishmentId, input.type ?? punishment.type, reason, "pending") };
  } catch {
    // UNIQUE(punishment_id): вторая апелляция обогнала проверку выше.
    const raced = existingStmt.get(input.punishmentId) as { id: number; number: number; status: AppealStatus } | undefined;
    return { ok: false, error: existingError(lang, raced) };
  }
}

// Юзер нажал «Отказаться» в DM-оффере. Отклонённая строка — финал: повторная
// апелляция по тому же наказанию отклоняется. Существующая строка (гонка с
// «Подать апелляцию» или повторный клик) не пишется и не считается ошибкой.
export function declineAppeal(input: { guildId: string; userId: string; punishmentId: number }): Result<Appeal | null> {
  const lang = guildLang(input.guildId);
  const punishment = getPunishment(input.punishmentId);
  if (!punishment || punishment.guild_id !== input.guildId) return { ok: false, error: trAppeals(lang, "notFound") };
  if (punishment.user_id !== input.userId) return { ok: false, error: trAppeals(lang, "notYours") };
  if (existingStmt.get(input.punishmentId)) return { ok: true, value: null };
  try {
    return { ok: true as const, value: insertAppeal(input.guildId, input.userId, input.punishmentId, punishment.type, trAppeals(lang, "declinedReason"), "declined") };
  } catch (error) {
    if (existingStmt.get(input.punishmentId)) return { ok: true, value: null };
    throw error;
  }
}

type ReviewResult = { appeal: Appeal; reversal: "unban" | "untimeout" | null; previousStatus: AppealStatus };
export function reviewAppeal(input: { guildId: string; appealId: number; action: ReviewAction; reviewerId: string; comment?: string | null }): ReviewResultValue {
  const lang = guildLang(input.guildId);
  const appeal = byIdStmt.get(input.appealId, input.guildId) as Appeal | undefined;
  if (!appeal) return { ok: false, error: trAppeals(lang, "appealNotFound"), status: 404 };
  if (appeal.status !== "pending" && appeal.status !== "reviewing") return { ok: false, error: trAppeals(lang, "appealClosedAlready"), status: 409 };
  if (input.action === "reviewing" && appeal.status === "reviewing") return { ok: false, error: trAppeals(lang, "alreadyReviewing"), status: 409 };
  const comment = typeof input.comment === "string" ? input.comment.trim().slice(0, 500) || null : null;
  const at = Date.now();
  const result = updateStmt.run(input.action, comment, at, input.reviewerId, at, input.appealId, input.guildId);
  if (result.changes === 0) return { ok: false, error: trAppeals(lang, "appealClosedAlready"), status: 409 };
  const reversal = input.action === "approved" ? reversalFor(appeal.type) : null;
  return { ok: true, value: { appeal: { ...appeal, status: input.action, moderator_comment: comment, updated_at: at, reviewed_by: input.reviewerId, reviewed_at: at }, reversal, previousStatus: appeal.status } };
}

// После одобренной апелляции отменить можно только ban (unban) и timeout
// (снятие): kick лишь удаляет юзера, варны — постоянные записи, automod
// повторяет одно из двух.
export function reversalFor(type: string): "unban" | "untimeout" | null {
  if (type === "ban") return "unban";
  if (type === "timeout") return "untimeout";
  return null;
}

export async function applyAppealReversal(lang: Locale, guildId: string, userId: string, reversal: "unban" | "untimeout"): Promise<{ ok: boolean; label: string }> {
  const label = punishmentLabel(lang, reversal === "unban" ? "ban" : "timeout");
  if (!process.env.DISCORD_TOKEN) return { ok: false, label };
  try {
    const response = reversal === "unban"
      ? await discordFetch(`/guilds/${guildId}/bans/${userId}`, { method: "DELETE" })
      : await discordFetch(`/guilds/${guildId}/members/${userId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ communication_disabled_until: null }) });
    return { ok: response.ok, label };
  } catch { return { ok: false, label }; }
}

export async function notifyAppealStatus(appeal: Appeal, reversal?: { ok: boolean; label: string } | null): Promise<boolean> {
  const lang = guildLang(appeal.guild_id);
  const guildRow = stmt.guildName.get(appeal.guild_id) as { name: string } | undefined;
  const server = guildRow?.name ?? trAppeals(lang, "serverFallback");
  const typeLabel = punishmentLabel(lang, appeal.type);
  const reason = appeal.reason.trim().slice(0, 500);
  const comment = appeal.moderator_comment ? trAppeals(lang, "dmComment", { c: appeal.moderator_comment }) : "";
  let content: string;
  if (appeal.status === "reviewing") content = trAppeals(lang, "dmReviewing", { n: String(appeal.number), server });
  else if (appeal.status === "approved") {
    const outcome = reversal
      ? (reversal.ok ? trAppeals(lang, "dmOutcomeReverted", { label: reversal.label }) : trAppeals(lang, "dmOutcomeFailed", { label: reversal.label }))
      : trAppeals(lang, "dmOutcomeCancelled");
    content = trAppeals(lang, "dmApproved", { n: String(appeal.number), server, type: typeLabel, outcome, reason, comment });
  } else if (appeal.status === "rejected") content = trAppeals(lang, "dmRejected", { n: String(appeal.number), server, type: typeLabel, reason, comment });
  else if (appeal.status === "closed") content = trAppeals(lang, "dmClosed", { n: String(appeal.number), server });
  else return false;
  return sendDiscordDM(appeal.user_id, content);
}

export type AppealListQuery = { guildId: string; status?: AppealStatus | "all"; userId?: string; moderatorId?: string; from?: number; to?: number; limit?: number; offset?: number };
// Набор фильтров ограничен — кэшируем готовые statements вместо prepare на
// каждый GET вкладки «Апелляции».
const listAppealCache = new Map<string, ReturnType<typeof db.prepare>>();

export function listAppeals(query: AppealListQuery): AppealView[] {
  const clauses = ["a.guild_id=?"];
  const params: SQLInputValue[] = [query.guildId];
  if (query.status && query.status !== "all") { clauses.push("a.status=?"); params.push(query.status); }
  if (query.userId) { clauses.push("a.user_id=?"); params.push(query.userId); }
  if (query.moderatorId) { clauses.push("a.reviewed_by=?"); params.push(query.moderatorId); }
  if (query.from !== undefined) { clauses.push("a.created_at>=?"); params.push(query.from); }
  if (query.to !== undefined) { clauses.push("a.created_at<=?"); params.push(query.to); }
  params.push(Math.max(1, Math.min(200, query.limit ?? 100)), Math.max(0, query.offset ?? 0));
  const key = clauses.join("|");
  let stmt = listAppealCache.get(key);
  if (!stmt) {
    if (listAppealCache.size >= 32) listAppealCache.clear();
    stmt = db.prepare(`SELECT a.*,m.reason AS punishment_reason,m.created_at AS punishment_created_at FROM appeals a JOIN moderation_actions m ON m.id=a.punishment_id WHERE ${clauses.join(" AND ")} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`);
    listAppealCache.set(key, stmt);
  }
  return stmt.all(...params) as AppealView[];
}