import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, jsonError } from "#lib/guild-access.ts";
import { loggingQueries } from "#db/queries.ts";
import { logKeys } from "#lib/labels.ts";
import { fromDto as fromLoggingDto, toDto as toLoggingDto, type LoggingDto } from "#contracts/logging.ts";
import { settingsPutRoute } from "#lib/settings-route.ts";
import { loggingState, loggingView } from "#lib/settings-views.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";

export const GET = guildRoute(async (_, { guildId }) => {
  return NextResponse.json<LoggingDto>(toLoggingDto(loggingState(guildId).state));
});

export const PUT = settingsPutRoute<LoggingDto>({
  load: guildId => loggingState(guildId),
  parse: body => {
    const value = body as Partial<LoggingDto> | null;
    // Snowflake-валидация: опечатка иначе молча отключила бы доставку логов —
    // бот не разрешил бы канал и терял записи без ошибок.
    if (!value || typeof value !== "object" || (value.channelId !== null && (typeof value.channelId !== "string" || !isSnowflake(value.channelId)))) {
      return { ok: false, response: jsonError("Некорректный канал") };
    }
    // Не-объект categories раньше молча выключал все категории (Boolean("x"[key]) === false).
    if (typeof value.categories !== "object" || value.categories === null || Array.isArray(value.categories)) {
      return { ok: false, response: jsonError("Некорректные категории") };
    }
    const categories = Object.fromEntries(logKeys.map(key => [key, Boolean(value.categories?.[key])]));
    return { ok: true, value: fromLoggingDto({ channelId: value.channelId, categories }) };
  },
  view: loggingView,
  save: (guildId, state) => {
    loggingQueries.upsert.run({ guild_id: guildId, channel_id: state.channelId, categories_json: JSON.stringify(state.categories), updated_at: Date.now() });
  },
  section: AUDIT_SECTION.logging,
  prefix: "Журнал событий: ",
  saveMissing: true,
});
