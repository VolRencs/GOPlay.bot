import { NextResponse } from "next/server.js";
import { withGuild } from "../../../../../src/lib/guild-access.ts";
import { db } from "../../../../../src/db/database.ts";
import type { AuditEntry, AuditListGet } from "../../../../../src/components/dashboard/types.ts";

export async function GET(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await withGuild(guildId);
  if (access instanceof Response) return access;
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const section = url.searchParams.get("section")?.trim().slice(0, 50) || null;

  // Чистое чтение: retention выполняется на записи (recordDashboardChange).
  const where = "guild_id=?" + (section ? " AND section=?" : "");
  const args: (string | number)[] = section ? [guildId, section] : [guildId];
  const entries = db.prepare(`SELECT id,user_name,section,summary,created_at FROM dashboard_audit WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as AuditEntry[];
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM dashboard_audit WHERE ${where}`).get(...args) as { count: number }).count;
  return NextResponse.json<AuditListGet>({ entries, total });
}