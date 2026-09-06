import { NextResponse } from "next/server.js";
import { withGuild } from "../../../../../src/lib/guild-access.ts";
import { recordDashboardChange } from "../../../../../src/lib/dashboard-audit.ts";
import { db } from "../../../../../src/db/database.ts";

export async function GET(_: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await withGuild(guildId);
  if (access instanceof Response) return access;
  const row = db.prepare("SELECT lang FROM guilds WHERE id=?").get(guildId) as { lang?: string } | undefined;
  return NextResponse.json({ lang: row?.lang === "en" ? "en" : "ru" });
}

export async function PUT(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await withGuild(guildId);
  if (access instanceof Response) return access;
  const body = await request.json().catch(() => null) as { lang?: unknown } | null;
  if (body?.lang !== "ru" && body?.lang !== "en") return NextResponse.json({ error: "Некорректный язык." }, { status: 400 });
  const updated = db.prepare("UPDATE guilds SET lang=?, updated_at=? WHERE id=? AND lang<>?").run(body.lang, Date.now(), guildId, body.lang);
  if (updated.changes === 0) return NextResponse.json({ ok: true, unchanged: true });
  recordDashboardChange(guildId, access.user, "Настройки", `Язык сообщений бота: ${body.lang === "en" ? "английский" : "русский"}.`);
  return NextResponse.json({ ok: true });
}
