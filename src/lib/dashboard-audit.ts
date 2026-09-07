import { db } from "../db/database.ts";

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