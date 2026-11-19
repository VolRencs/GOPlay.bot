import { NextResponse } from "next/server.js";
import { adminRoute, discordFetch } from "#lib/guild-access.ts";
import { adminQueries } from "#db/queries.ts";
import { ttlCacheAsync } from "#lib/cache.ts";
import { DAY_MS } from "#lib/constants.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AdminDataDto } from "#contracts/dashboard.ts";

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

export const GET = adminRoute(async () => {
  const cutoff = new Date(Date.now() - 7 * DAY_MS).toISOString().slice(0, 10);
  const activity = adminQueries.activity7d.get(cutoff)!;
  const members = await memberTotal.get("total").catch(() => null);
  const rows = adminQueries.guilds.all();
  return NextResponse.json<AdminDataDto>({
    ...(await botStatus()),
    guildCount: rows.length,
    messages7d: Number(activity.m),
    moderation7d: Number(activity.mod),
    members,
    guilds: rows.map(g => ({ id: g.id, name: g.name, messages: Number(g.messages), panels: Number(g.panels), events: Number(g.events) })),
  });
});
