import { NextResponse } from "next/server.js";
import { adminRoute, discordFetch } from "../../../../src/lib/guild-access.ts";
import { db } from "../../../../src/db/database.ts";
import { ttlCacheAsync } from "../../../../src/lib/cache.ts";
import { DAY_MS } from "../../../../src/lib/constants.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function botStatus(): { online: boolean; uptimeMs: number | null } {
  try {
    const hb = JSON.parse(readFileSync(join(process.cwd(), "data", "heartbeat"), "utf8")) as { startedAt?: number; ts?: number };
    if (typeof hb.startedAt !== "number" || typeof hb.ts !== "number") return { online: false, uptimeMs: null };
    const online = Date.now() - hb.ts < 3 * 60_000;
    return { online, uptimeMs: online ? Date.now() - hb.startedAt : null };
  } catch {
    return { online: false, uptimeMs: null };
  }
}

const memberTotal = ttlCacheAsync<string, number>(async () => {
  const response = await discordFetch("/users/@me/guilds?with_counts=true");
  if (!response.ok) throw new Error(`Discord ответил ${response.status}.`);
  const guilds = await response.json() as { approximate_member_count?: number }[];
  return guilds.reduce((sum, g) => sum + (g.approximate_member_count ?? 0), 0);
}, 300_000);

const guildCountStmt = db.prepare("SELECT COUNT(*) AS c FROM guilds");
const activity7dStmt = db.prepare("SELECT COALESCE(SUM(messages),0) AS m, COALESCE(SUM(moderation),0) AS mod FROM guild_daily_metrics WHERE day>=?");

export const GET = adminRoute(async () => {
  const cutoff = new Date(Date.now() - 7 * DAY_MS).toISOString().slice(0, 10);
  const guilds = Number(guildCountStmt.get()?.c ?? 0);
  const activity = activity7dStmt.get(cutoff) as { m: number; mod: number };
  const members = await memberTotal.get("total").catch(() => null);
  return NextResponse.json({ ...botStatus(), guilds, messages7d: Number(activity.m), moderation7d: Number(activity.mod), members });
});
