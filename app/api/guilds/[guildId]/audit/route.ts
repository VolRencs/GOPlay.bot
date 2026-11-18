import { NextResponse } from "next/server.js";
import { guildRoute } from "#lib/guild-access.ts";
import { auditQueries } from "#db/queries.ts";
import { toAuditDto, type AuditListDto } from "#contracts/dashboard.ts";

export const GET = guildRoute(async (request, { guildId }) => {
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit"));
  const rawOffset = Number(url.searchParams.get("offset"));
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(200, rawLimit) : 50;
  const offset = Number.isSafeInteger(rawOffset) && rawOffset > 0 ? Math.min(10_000_000, rawOffset) : 0;
  const section = url.searchParams.get("section")?.trim().slice(0, 50) || null;

  const rows = section ? auditQueries.bySection.all(guildId, section, limit, offset) : auditQueries.list.all(guildId, limit, offset);
  const total = (section ? auditQueries.countBySection.get(guildId, section) : auditQueries.count.get(guildId))?.total ?? 0;
  return NextResponse.json<AuditListDto>({ entries: rows.map(toAuditDto), total });
});
