import { NextResponse } from "next/server.js";
import { withGuild } from "../../../../../src/lib/guild-access.ts";
import { appealStatuses, listAppeals, type AppealListQuery, type AppealStatus } from "../../../../../src/lib/appeals.ts";

export async function GET(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await withGuild(guildId);
  if (access instanceof Response) return access;
  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status") ?? "all";
  const status: AppealStatus | "all" = appealStatuses.includes(rawStatus as AppealStatus) ? rawStatus as AppealStatus : "all";
  const userId = url.searchParams.get("userId")?.trim() || undefined;
  const moderatorId = url.searchParams.get("moderatorId")?.trim() || undefined;
  const from = Number(url.searchParams.get("from")) || undefined;
  const to = Number(url.searchParams.get("to")) || undefined;
  const limit = Number(url.searchParams.get("limit")) || 100;
  const offset = Number(url.searchParams.get("offset")) || 0;
  const query: AppealListQuery = { guildId, status, limit, offset };
  if (userId !== undefined) query.userId = userId;
  if (moderatorId !== undefined) query.moderatorId = moderatorId;
  if (from !== undefined) query.from = from;
  if (to !== undefined) query.to = to;
  const appeals = listAppeals(query);
  return NextResponse.json({ appeals });
}