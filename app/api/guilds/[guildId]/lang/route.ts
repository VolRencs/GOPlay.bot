import { NextResponse } from "next/server.js";
import { guildRoute, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
import { guildLang, invalidateGuildLang } from "../../../../../src/lib/i18n/bot.ts";
import { recordDashboardChange } from "../../../../../src/lib/dashboard-audit.ts";
import { db } from "../../../../../src/db/database.ts";
import type { LangGet, LangPutBody } from "../../../../../src/components/dashboard/types.ts";

const langUpdateStmt = db.prepare("UPDATE guilds SET lang=?, updated_at=? WHERE id=? AND lang<>?");

export const GET = guildRoute(async (_, { guildId }) => {
  return NextResponse.json<LangGet>({ lang: guildLang(guildId) });
});

export const PUT = guildRoute(async (request, { guildId, user }) => {
  const body = await readJson<LangPutBody>(request);
  if (body?.lang !== "ru" && body?.lang !== "en") return jsonError("Некорректный язык.");
  const updated = langUpdateStmt.run(body.lang, Date.now(), guildId, body.lang);
  if (updated.changes === 0) return NextResponse.json({ ok: true, unchanged: true });
  invalidateGuildLang(guildId);
  recordDashboardChange(guildId, user, "Настройки", `Язык сообщений бота: ${body.lang === "en" ? "английский" : "русский"}.`);
  return NextResponse.json({ ok: true });
});
