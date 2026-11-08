import { jsonError } from "#lib/guild-access.ts";
import { guildLang, invalidateGuildLang } from "#lib/i18n/bot.ts";
import { settingsGetRoute, settingsPutRoute } from "#lib/settings-route.ts";
import { langState, langView } from "#lib/settings-views.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";
import { langQueries } from "#db/queries.ts";
import { fromLangDto, toLangDto, type LangDto } from "#contracts/dashboard.ts";

export const GET = settingsGetRoute(guildId => toLangDto(guildLang(guildId)));

export const PUT = settingsPutRoute<string>({
  load: guildId => langState(guildId),
  parse: body => {
    const value = body as Partial<LangDto> | null;
    if (value?.lang !== "ru" && value?.lang !== "en") return { ok: false, response: jsonError("Некорректный язык.") };
    return { ok: true, value: fromLangDto({ lang: value.lang }) };
  },
  view: langView,
  save: (guildId, lang) => {
    if (langQueries.update.run(lang, guildId, lang).changes > 0) invalidateGuildLang(guildId);
  },
  section: AUDIT_SECTION.settings,
  prefix: "Язык сообщений бота: ",
});
