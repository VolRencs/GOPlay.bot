import { db } from "../db/database.ts";

type AuditActor = { id: string; name: string };

const insertStmt = db.prepare(
  "INSERT INTO dashboard_audit(guild_id,user_id,user_name,section,summary,created_at) VALUES(?,?,?,?,?,?)",
);

export function recordDashboardChange(guildId: string, actor: AuditActor, section: string, summary: string) {
  insertStmt.run(guildId, actor.id.slice(0, 100), actor.name.slice(0, 100), section.slice(0, 50), summary.slice(0, 500), Date.now());
}