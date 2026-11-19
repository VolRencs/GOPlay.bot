import { NextResponse } from "next/server.js";
import { guildMemberNamesFor, guildRoute } from "#lib/guild-access.ts";
import { statsQueries } from "#db/queries.ts";
import { guildResourceSnapshot } from "#lib/guild-resources.ts";
import { moderationLabel } from "#lib/labels.ts";
import { guildLang } from "#lib/i18n/bot.ts";
import { DAY_MS } from "#lib/constants.ts";
import { formatDay } from "#lib/format.ts";
import { ttlCacheAsync } from "#lib/cache.ts";
import type { StatsGet } from "#contracts/dashboard.ts";

const iso = (at: number) => new Date(at).toISOString().slice(0, 10);
type StatsPeriod = "24h" | "7d" | "30d";

async function loadStats(guildId: string, period: StatsPeriod): Promise<StatsGet> {
  const lang = guildLang(guildId);
  const windowDays = ({"24h":1,"7d":7,"30d":30} as const)[period];
  const nowMs = Date.now();
  // Day buckets include today; 7d must mean today + the previous six days, not eight.
  const cutoff = iso(nowMs - (period === "24h" ? 1 : windowDays - 1) * DAY_MS);
  const snapshotPromise = guildResourceSnapshot(guildId).catch(() => null);

  const days = period === "24h" ? [] : Array.from({ length: windowDays }, (_, i) => iso(nowMs - (windowDays - 1 - i) * DAY_MS));
  const byDay = new Map((days.length ? statsQueries.daily.all(guildId, cutoff) : []).map(row => [row.day, row]));
  const totals = days.reduce((sum, day) => {
    const row = byDay.get(day);
    return row ? { joins: sum.joins + row.joins, leaves: sum.leaves + row.leaves, messages: sum.messages + row.messages, moderation: sum.moderation + row.moderation } : sum;
  }, { joins: 0, leaves: 0, messages: 0, moderation: 0 });

  let points: { label: string; messages: number }[];
  let peakInWindow: { day: string; hour: number; messages: number } | null = null;
  if (period === "24h") {
    const rows = statsQueries.hourly.all(guildId, iso(nowMs - DAY_MS));
    const byHour = new Map(rows.map(row => [`${row.day}:${row.hour}`, row]));
    let joins = 0, leaves = 0;
    points = Array.from({ length: 24 }, (_, i) => {
      const t = new Date(nowMs - (23 - i) * 3_600_000);
      const day = iso(t.getTime());
      const hour = t.getUTCHours();
      const row = byHour.get(`${day}:${hour}`);
      joins += row?.joins ?? 0;
      leaves += row?.leaves ?? 0;
      if (row && (!peakInWindow || row.messages > peakInWindow.messages)) peakInWindow = { day, hour, messages: row.messages };
      return { label: `${String(hour).padStart(2, "0")}:00`, messages: row?.messages ?? 0 };
    });
    totals.joins = joins;
    totals.leaves = leaves;
  } else {
    points = days.map(day => ({ label: formatDay(day), messages: byDay.get(day)?.messages ?? 0 }));
  }

  const moderation = statsQueries.moderation.all(guildId, nowMs - windowDays * DAY_MS).map(row => ({ type: row.type, label: moderationLabel(lang, row.type), count: row.count }));

  if (period === "24h") {
    totals.messages = points.reduce((sum, point) => sum + point.messages, 0);
    totals.moderation = moderation.reduce((sum, row) => sum + row.count, 0);
  }

  const topUserRows = statsQueries.topUsers.all(guildId, cutoff);
  const namesPromise = guildMemberNamesFor(guildId, topUserRows.map(row => row.id)).catch(() => new Map<string, string>());
  const topChannelRows = statsQueries.topChannels.all(guildId, cutoff);
  const peakHour = peakInWindow ?? statsQueries.peakHour.get(guildId, cutoff) ?? null;
  const [snapshot, memberNames] = await Promise.all([snapshotPromise, namesPromise]);
  const channelNames = new Map(snapshot?.channels.map(channel => [channel.id, channel.name]) ?? []);
  return {
    points,
    totals,
    moderation,
    topChannels: topChannelRows.map(row => ({ ...row, name: channelNames.get(row.id) ?? "Неизвестный канал" })),
    topUsers: topUserRows.map(row => ({ ...row, name: memberNames.get(row.id) ?? "Неизвестный участник" })),
    peakHour,
  };
}

const statsCache = ttlCacheAsync<string, StatsGet>((key) => {
  const [guildId, period] = key.split(":") as [string, StatsPeriod];
  return loadStats(guildId, period);
}, 15_000, true);

export const GET = guildRoute(async (request, { guildId }) => {
  const requested = new URL(request.url).searchParams.get("period");
  const period: StatsPeriod = requested === "24h" || requested === "30d" ? requested : "7d";
  return NextResponse.json(await statsCache.get(`${guildId}:${period}`));
});
