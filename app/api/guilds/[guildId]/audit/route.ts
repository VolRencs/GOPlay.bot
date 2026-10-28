import { NextResponse } from "next/server.js";
import { guildRoute } from "../../../../../src/lib/guild-access.ts";
import { auditQueries } from "../../../../../src/db/queries.ts";
import type { AuditEntry, AuditListGet } from "../../../../../src/contracts/dashboard.ts";

// Чистое чтение: retention выполняется на записи (recordDashboardChange).
export const GET = guildRoute(async (request, { guildId }) => {
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const section = url.searchParams.get("section")?.trim().slice(0, 50) || null;

  const rows = (section ? auditQueries.bySection.all(guildId, section, limit, offset) : auditQueries.list.all(guildId, limit, offset)) as (AuditEntry & { total: number })[];
  const total = rows[0]?.total ?? 0;
  const entries: AuditEntry[] = rows.map(({ total: _total, ...entry }) => entry);
  return NextResponse.json<AuditListGet>({ entries, total });
});