import { NextResponse } from "next/server.js";
import { requireAdmin } from "../../../../src/lib/guild-access.ts";
import { db } from "../../../../src/db/database.ts";

const guildsStmt = db.prepare("SELECT id,name,icon FROM guilds ORDER BY name");
const messagesStmt = db.prepare("SELECT guild_id,SUM(messages) AS m FROM guild_daily_metrics GROUP BY guild_id");
const panelsStmt = db.prepare("SELECT guild_id,COUNT(*) AS c FROM self_role_panels GROUP BY guild_id");
const eventsStmt = db.prepare("SELECT guild_id,COUNT(*) AS c FROM events GROUP BY guild_id");

type SumRow = { guild_id: string; m: number };
type CountRow = { guild_id: string; c: number };

export async function GET() {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;
  const guilds = guildsStmt.all() as { id: string; name: string; icon: string | null }[];
  const messages = new Map((messagesStmt.all() as SumRow[]).map(r => [r.guild_id, Number(r.m)]));
  const panels = new Map((panelsStmt.all() as CountRow[]).map(r => [r.guild_id, Number(r.c)]));
  const events = new Map((eventsStmt.all() as CountRow[]).map(r => [r.guild_id, Number(r.c)]));
  return NextResponse.json({
    guilds: guilds.map(g => ({ ...g, messages: messages.get(g.id) ?? 0, panels: panels.get(g.id) ?? 0, events: events.get(g.id) ?? 0 })),
  });
}
