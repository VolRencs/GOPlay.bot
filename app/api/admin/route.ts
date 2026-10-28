import { NextResponse } from "next/server.js";
import { adminRoute, discordFetch } from "../../../src/lib/guild-access.ts";
import { adminQueries } from "../../../src/db/queries.ts";
import { ttlCacheAsync } from "../../../src/lib/cache.ts";
import { DAY_MS } from "../../../src/lib/constants.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function botStatus(): Promise<{ online: boolean; uptimeMs: number | null }> {
  try {
    const hb = JSON.parse(await readFile(join(process.cwd(), "data", "heartbeat"), "utf8")) as { startedAt?: number; ts?: number };
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


type SumRow = { guild_id: string; m: number };
type CountRow = { guild_id: string; c: number };

export const GET = adminRoute(async () => {
  const cutoff = new Date(Date.now() - 7 * DAY_MS).toISOString().slice(0, 10);
  const guildCount = Number(adminQueries.guildCount.get()?.c ?? 0);
  const activity = adminQueries.activity7d.get(cutoff) as { m: number; mod: number };
  const members = await memberTotal.get("total").catch(() => null);
  const rows = adminQueries.guilds.all() as { id: string; name: string; icon: string | null }[];
  const messages = new Map((adminQueries.messages.all() as SumRow[]).map(r => [r.guild_id, Number(r.m)]));
  const panels = new Map((adminQueries.panels.all() as CountRow[]).map(r => [r.guild_id, Number(r.c)]));
  const events = new Map((adminQueries.events.all() as CountRow[]).map(r => [r.guild_id, Number(r.c)]));
  return NextResponse.json({
    ...(await botStatus()),
    guildCount,
    messages7d: Number(activity.m),
    moderation7d: Number(activity.mod),
    members,
    guilds: rows.map(g => ({ ...g, messages: messages.get(g.id) ?? 0, panels: panels.get(g.id) ?? 0, events: events.get(g.id) ?? 0 })),
  });
});
