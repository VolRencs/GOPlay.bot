import { db } from "../db/database.ts";
import { stableJson } from "./json.ts";

type AuditActor = { id: string; name: string };

const insertStmt = db.prepare(
  "INSERT INTO dashboard_audit(guild_id,user_id,user_name,section,summary,created_at) VALUES(?,?,?,?,?,?)",
);

const RETENTION = 1000;
const pruneStmt = db.prepare(
  "DELETE FROM dashboard_audit WHERE guild_id=? AND created_at < (SELECT created_at FROM dashboard_audit WHERE guild_id=? ORDER BY created_at DESC LIMIT 1 OFFSET ?)",
);

export function recordDashboardChange(guildId: string, actor: AuditActor, section: string, summary: string) {
  insertStmt.run(guildId, actor.id.slice(0, 100), actor.name.slice(0, 100), section.slice(0, 50), summary.slice(0, 500), Date.now());
  // Retention — на записи, а не на чтении: GET аудита остаётся чистым SELECT без гонок.
  try {
    pruneStmt.run(guildId, guildId, RETENTION);
  } catch { /* prune — best-effort, запись уже сохранена */ }
}

function short(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "вкл" : "выкл";
  if (typeof value === "number") return String(value);
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** Дельта двух «отображаемых» объектов (ключи — подписи полей): возвращает
 *  только отличающиеся поля `Подпись: было → стало`, массивы — добавлено/убрано.
 *  `opaque` задаёт текст для полей, значения которых показывать не нужно
 *  (сравнение всё равно идёт по значению). Пустая строка — изменений нет. */
export function describeChanges(before: Record<string, unknown>, after: Record<string, unknown>, opaque: Record<string, string> = {}): string {
  const parts: string[] = [];
  for (const [label, value] of Object.entries(after)) {
    const previous = before[label];
    const prevList = Array.isArray(previous) ? previous : null;
    const nextList = Array.isArray(value) ? value : null;
    if (prevList || nextList) {
      const prevKeys = new Set((prevList ?? []).map(item => stableJson(item)));
      const nextKeys = new Set((nextList ?? []).map(item => stableJson(item)));
      const added = (nextList ?? []).filter(item => !prevKeys.has(stableJson(item)));
      const removed = (prevList ?? []).filter(item => !nextKeys.has(stableJson(item)));
      if (!added.length && !removed.length) continue;
      const changes = [added.length ? `добавлено ${added.map(short).join(", ")}` : "", removed.length ? `убрано ${removed.map(short).join(", ")}` : ""].filter(Boolean);
      parts.push(`${label}: ${changes.join("; ")}`);
      continue;
    }
    if (stableJson(previous) === stableJson(value)) continue;
    parts.push(`${label}: ${opaque[label] ?? `${short(previous)} → ${short(value)}`}`);
  }
  const summary = parts.join(" · ");
  return summary.length > 480 ? `${summary.slice(0, 479)}…` : summary;
}

/** Запись дельты в журнал; пустая дельта записи не создаёт. */
export function recordDashboardDiff(
  guildId: string, actor: AuditActor, section: string, prefix: string,
  before: Record<string, unknown>, after: Record<string, unknown>, opaque?: Record<string, string>,
): boolean {
  const changes = describeChanges(before, after, opaque);
  if (!changes) return false;
  recordDashboardChange(guildId, actor, section, `${prefix}${changes}`);
  return true;
}