import { NextResponse } from "next/server.js";
import { guildRoute } from "#lib/guild-access.ts";
import { auditQueries } from "#db/queries.ts";
import { toDto as toAuditEntryDto, type AuditListDto } from "#contracts/audit.ts";

// Чистое чтение: retention выполняется на записи (recordDashboardChange).
export const GET = guildRoute(async (request, { guildId }) => {
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const section = url.searchParams.get("section")?.trim().slice(0, 50) || null;

  const rows = section ? auditQueries.bySection.all(guildId, section, limit, offset) : auditQueries.list.all(guildId, limit, offset);
  const total = rows[0]?.total ?? 0;
  return NextResponse.json<AuditListDto>({ entries: rows.map(toAuditEntryDto), total });
});