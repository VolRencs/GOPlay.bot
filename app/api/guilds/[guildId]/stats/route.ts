import { NextResponse } from "next/server.js";
import { discordFetch, guildMemberNames, guildRoute } from "../../../../../src/lib/guild-access.ts";
import { db } from "../../../../../src/db/database.ts";
import { ttlCacheAsync } from "../../../../../src/lib/cache.ts";
import { moderationLabel } from "../../../../../src/lib/labels.ts";
import { guildLang } from "../../../../../src/lib/i18n/bot.ts";
import { DAY_MS } from "../../../../../src/lib/constants.ts";
import type { StatsGet } from "../../../../../src/components/dashboard/types.ts";

const iso = (at: number) => new Date(at).toISOString().slice(0, 10);

const discord = async (path: string) => {
  const response = await discordFetch(path);
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
};

const channelNames = ttlCacheAsync<string, Record<string, string>>(async guildId => {
  const channels = await discord(`/guilds/${guildId}/channels`) as { id: string; name: string }[];
  return Object.fromEntries(channels.map(channel => [channel.id, channel.name]));
}, DAY_MS, true);

// Statements готовятся один раз на модуль: SQL статический, параметры через `?`.
const dailyStmt = db.prepare("SELECT day,joins,leaves,messages,moderation FROM guild_daily_metrics WHERE guild_id=? AND day>=? ORDER BY day");
const hourlyStmt = db.prepare("SELECT day,hour,messages FROM guild_hourly_messages WHERE guild_id=? AND day>=? ORDER BY day,hour");
const moderationStmt = db.prepare("SELECT type,COUNT(*) AS count FROM moderation_actions WHERE guild_id=? AND created_at>? GROUP BY type ORDER BY count DESC");
const topChannelsStmt = db.prepare("SELECT channel_id AS id,SUM(messages) AS messages FROM guild_daily_channel_stats WHERE guild_id=? AND day>=? GROUP BY channel_id ORDER BY messages DESC LIMIT 5");
const topUsersStmt = db.prepare("SELECT user_id AS id,SUM(messages) AS messages FROM guild_daily_user_stats WHERE guild_id=? AND day>=? GROUP BY user_id ORDER BY messages DESC LIMIT 5");
const peakHourStmt = db.prepare("SELECT day,hour,messages FROM guild_hourly_messages WHERE guild_id=? AND day>=? ORDER BY messages DESC LIMIT 1");

export const GET = guildRoute(async (request, { guildId }) => {
  const lang = guildLang(guildId);
  const requested = new URL(request.url).searchParams.get("period");
  const period = requested === "24h" || requested === "30d" ? requested : "7d";
  const windowDays = ({"24h":1,"7d":7,"30d":30} as const)[period];
  const nowMs = Date.now();
  const cutoff = iso(nowMs - windowDays * DAY_MS);

  const dailyRows = dailyStmt.all(guildId, cutoff) as { day: string; joins: number; leaves: number; messages: number; moderation: number }[];
  const byDay = new Map(dailyRows.map(row => [row.day, row]));
  const days = period === "24h" ? [iso(nowMs)] : Array.from({ length: windowDays }, (_, i) => iso(nowMs - (windowDays - 1 - i) * DAY_MS));

  const totals = days.reduce((sum, day) => {
    const row = byDay.get(day);
    return row ? { joins: sum.joins + row.joins, leaves: sum.leaves + row.leaves, messages: sum.messages + row.messages, moderation: sum.moderation + row.moderation } : sum;
  }, { joins: 0, leaves: 0, messages: 0, moderation: 0 });

  let points: { label: string; messages: number }[];
  if (period === "24h") {
    const rows = hourlyStmt.all(guildId, iso(nowMs - DAY_MS)) as { day: string; hour: number; messages: number }[];
    const byHour = new Map(rows.map(row => [`${row.day}:${row.hour}`, row.messages]));
    points = Array.from({ length: 24 }, (_, i) => { const t = new Date(nowMs - (23 - i) * 3_600_000); return { label: `${String(t.getUTCHours()).padStart(2, "0")}:00`, messages: byHour.get(`${iso(t.getTime())}:${t.getUTCHours()}`) ?? 0 }; });
  } else {
    points = days.map(day => ({ label: new Date(`${day}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" }), messages: byDay.get(day)?.messages ?? 0 }));
  }

  const moderation = (moderationStmt.all(guildId, nowMs - windowDays * DAY_MS) as { type: string; count: number }[]).map(row => ({ type: row.type, label: moderationLabel(lang, row.type), count: row.count }));

  if (period === "24h") {
    // Скользящие 24 часа, а не сумма двух календарных дней (было до 48 ч):
    // сообщения — из почасовых бакетов, модерация — по точному cutoff выше.
    totals.messages = points.reduce((sum, point) => sum + point.messages, 0);
    totals.moderation = moderation.reduce((sum, row) => sum + row.count, 0);
  }

  const topChannels = await channelNames.get(guildId).catch(() => ({} as Record<string, string>)).then(names => (topChannelsStmt.all(guildId, cutoff) as { id: string; messages: number }[]).map(row => ({ ...row, name: names[row.id] ?? "Неизвестный канал" })));
  const memberNames = await guildMemberNames(guildId).catch(() => new Map<string, string>());
  const topUsers = (topUsersStmt.all(guildId, cutoff) as { id: string; messages: number }[]).map(row => ({ ...row, name: memberNames.get(row.id) ?? "Неизвестный участник" }));

  const peakHour = (peakHourStmt.get(guildId, cutoff) as { day: string; hour: number; messages: number } | undefined) ?? null;

  return NextResponse.json<StatsGet>({ period, points, totals, moderation, topChannels, topUsers, peakHour });
});