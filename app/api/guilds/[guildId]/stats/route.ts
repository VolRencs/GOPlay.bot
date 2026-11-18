import { NextResponse } from "next/server.js";
import { guildMemberNamesFor, guildRoute } from "#lib/guild-access.ts";
import { statsQueries } from "#db/queries.ts";
import { guildResourceSnapshot } from "#lib/guild-resources.ts";
import { moderationLabel } from "#lib/labels.ts";
import { guildLang } from "#lib/i18n/bot.ts";
import { DAY_MS } from "#lib/constants.ts";
import { formatDay } from "#lib/format.ts";
import type { StatsGet } from "#contracts/dashboard.ts";

const iso = (at: number) => new Date(at).toISOString().slice(0, 10);

export const GET = guildRoute(async (request, { guildId }) => {
  const lang = guildLang(guildId);
  const requested = new URL(request.url).searchParams.get("period");
  const period = requested === "24h" || requested === "30d" ? requested : "7d";
  const windowDays = ({"24h":1,"7d":7,"30d":30} as const)[period];
  const nowMs = Date.now();
  const cutoff = iso(nowMs - windowDays * DAY_MS);

  const days = period === "24h" ? [] : Array.from({ length: windowDays }, (_, i) => iso(nowMs - (windowDays - 1 - i) * DAY_MS));
  const byDay = new Map((days.length ? statsQueries.daily.all(guildId, cutoff) : []).map(row => [row.day, row]));
  const totals = days.reduce((sum, day) => {
    const row = byDay.get(day);
    return row ? { joins: sum.joins + row.joins, leaves: sum.leaves + row.leaves, messages: sum.messages + row.messages, moderation: sum.moderation + row.moderation } : sum;
  }, { joins: 0, leaves: 0, messages: 0, moderation: 0 });

  let points: { label: string; messages: number }[];
  if (period === "24h") {
    const rows = statsQueries.hourly.all(guildId, iso(nowMs - DAY_MS));
    const byHour = new Map(rows.map(row => [`${row.day}:${row.hour}`, row]));
    let joins = 0, leaves = 0;
    points = Array.from({ length: 24 }, (_, i) => {
      const t = new Date(nowMs - (23 - i) * 3_600_000);
      const row = byHour.get(`${iso(t.getTime())}:${t.getUTCHours()}`);
      joins += row?.joins ?? 0;
      leaves += row?.leaves ?? 0;
      return { label: `${String(t.getUTCHours()).padStart(2, "0")}:00`, messages: row?.messages ?? 0 };
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
  const [snapshot, memberNames] = await Promise.all([
    guildResourceSnapshot(guildId).catch(() => null),
    guildMemberNamesFor(guildId, topUserRows.map(row => row.id)).catch(() => new Map<string, string>()),
  ]);
  const channelNames = new Map(snapshot?.channels.map(channel => [channel.id, channel.name]) ?? []);
  const topChannels = statsQueries.topChannels.all(guildId, cutoff).map(row => ({ ...row, name: channelNames.get(row.id) ?? "Неизвестный канал" }));
  const topUsers = topUserRows.map(row => ({ ...row, name: memberNames.get(row.id) ?? "Неизвестный участник" }));

  const peakHour = statsQueries.peakHour.get(guildId, cutoff) ?? null;

  return NextResponse.json<StatsGet>({ points, totals, moderation, topChannels, topUsers, peakHour });
});
