import { isSnowflakeOrNull, jsonError } from "#lib/guild-access.ts";
import { loggingQueries } from "#db/queries.ts";
import { logKeys } from "#lib/labels.ts";
import { fromDto as fromLoggingDto, type LoggingDto } from "#contracts/logging.ts";
import { settingsGetRoute, settingsPutRoute } from "#lib/settings-route.ts";
import { loggingState, loggingView } from "#lib/settings-views.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";
import { CHANNEL_TYPES, resourceError, validateResources } from "#lib/guild-resources.ts";

export const GET = settingsGetRoute(guildId => loggingState(guildId).state);

export const PUT = settingsPutRoute<LoggingDto>({
  load: guildId => loggingState(guildId),
  parse: body => {
    const value = body as Partial<LoggingDto> | null;
    if (!value || typeof value !== "object" || !isSnowflakeOrNull(value.channelId)) {
      return { ok: false, response: jsonError("Некорректный канал") };
    }
    if (typeof value.categories !== "object" || value.categories === null || Array.isArray(value.categories)) {
      return { ok: false, response: jsonError("Некорректные категории") };
    }
    const categories = Object.fromEntries(logKeys.map(key => [key, Boolean(value.categories?.[key])]));
    return { ok: true, value: fromLoggingDto({ channelId: value.channelId, categories }) };
  },
  validate: async (guildId, value) => {
    const result = await validateResources(guildId, {
      channels: { ids: [value.channelId], types: CHANNEL_TYPES.text },
    });
    return result.ok ? null : resourceError(result);
  },
  view: loggingView,
  save: (guildId, state) => {
    loggingQueries.upsert.run({ guild_id: guildId, channel_id: state.channelId, categories_json: JSON.stringify(state.categories), updated_at: Date.now() });
  },
  section: AUDIT_SECTION.logging,
  prefix: "Журнал событий: ",
  saveMissing: true,
});
