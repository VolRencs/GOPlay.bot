import { NextResponse } from "next/server.js";
import { guildRoute, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
import { guildLang, invalidateGuildLang } from "../../../../../src/lib/i18n/bot.ts";
import { recordDashboardDiff } from "../../../../../src/lib/dashboard-audit.ts";
import { AUDIT_SECTION } from "../../../../../src/lib/audit-sections.ts";
import { langQueries } from "../../../../../src/db/queries.ts";
import type { LangGet } from "../../../../../src/lib/labels.ts";

export const GET = guildRoute(async (_, { guildId }) => {
  return NextResponse.json<LangGet>({ lang: guildLang(guildId) });
});

export const PUT = guildRoute(async (request, { guildId, user }) => {
  const body = await readJson<LangGet>(request);
  if (body?.lang !== "ru" && body?.lang !== "en") return jsonError("Некорректный язык.");
  const previous = guildLang(guildId);
  const updated = langQueries.update.run(body.lang, Date.now(), guildId, body.lang);
  if (updated.changes === 0) return NextResponse.json({ ok: true, unchanged: true });
  invalidateGuildLang(guildId);
  const label = (lang: "ru" | "en") => lang === "en" ? "английский" : "русский";
  recordDashboardDiff(guildId, user, AUDIT_SECTION.settings, "Язык сообщений бота: ", { "Язык": label(previous) }, { "Язык": label(body.lang) });
  return NextResponse.json({ ok: true });
});
