import { NextResponse } from "next/server.js";
import { guildRoute } from "../../../../../src/lib/guild-access.ts";
import { db } from "../../../../../src/db/database.ts";
import type { AuditEntry, AuditListGet } from "../../../../../src/components/dashboard/types.ts";

export const GET = guildRoute(async (request, { guildId }) => {
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const section = url.searchParams.get("section")?.trim().slice(0, 50) || null;

  // Чистое чтение: retention выполняется на записи (recordDashboardChange).
  const where = "guild_id=?" + (section ? " AND section=?" : "");
  const args: (string | number)[] = section ? [guildId, section] : [guildId];
  const rows = db.prepare(`SELECT id,user_name,section,summary,created_at,COUNT(*) OVER() AS total FROM dashboard_audit WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as (AuditEntry & { total: number })[];
  const total = rows[0]?.total ?? 0;
  const entries: AuditEntry[] = rows.map(({ total: _total, ...entry }) => entry);
  return NextResponse.json<AuditListGet>({ entries, total });
});