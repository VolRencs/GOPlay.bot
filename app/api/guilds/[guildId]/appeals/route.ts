import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, jsonError } from "../../../../../src/lib/guild-access.ts";
import { appealStatuses, listAppeals, type AppealListQuery, type AppealsListGet, type AppealStatus } from "../../../../../src/lib/appeals.ts";

export const GET = guildRoute(async (request, { guildId }) => {
  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status") ?? "all";
  const status: AppealStatus | "all" = appealStatuses.includes(rawStatus as AppealStatus) ? rawStatus as AppealStatus : "all";
  const userId = url.searchParams.get("userId")?.trim() || undefined;
  const moderatorId = url.searchParams.get("moderatorId")?.trim() || undefined;
  if ((userId !== undefined && !isSnowflake(userId)) || (moderatorId !== undefined && !isSnowflake(moderatorId)))
    return jsonError("Некорректный ID пользователя.");
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const from = fromRaw === null || fromRaw === "" ? undefined : Number(fromRaw);
  const to = toRaw === null || toRaw === "" ? undefined : Number(toRaw);
  if ((from !== undefined && !Number.isFinite(from)) || (to !== undefined && !Number.isFinite(to)))
    return jsonError("Некорректный диапазон дат.");
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 100));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const query: AppealListQuery = { guildId, status, limit, offset };
  if (userId !== undefined) query.userId = userId;
  if (moderatorId !== undefined) query.moderatorId = moderatorId;
  if (from !== undefined) query.from = from;
  if (to !== undefined) query.to = to;
  const appeals = listAppeals(query);
  return NextResponse.json<AppealsListGet>({ appeals });
});