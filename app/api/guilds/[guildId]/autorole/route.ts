import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, jsonError } from "#lib/guild-access.ts";
import { autoroleSettingsFor, invalidateAutoroleSettings } from "#lib/autorole.ts";
import { fromDto as fromAutoroleDto, type AutoroleDto } from "#contracts/autorole.ts";
import { settingsPutRoute } from "#lib/settings-route.ts";
import { autoroleState, autoroleView } from "#lib/settings-views.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";
import { stmt } from "#db/statements.ts";

export const GET = guildRoute(async (_, { guildId }) => {
  return NextResponse.json<AutoroleDto>(autoroleSettingsFor(guildId));
});

export const PUT = settingsPutRoute<AutoroleDto>({
  load: guildId => autoroleState(guildId),
  parse: body => {
    const value = body as Partial<AutoroleDto> | null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, response: jsonError("Некорректное тело запроса.") };
    if (typeof value.enabled !== "boolean") return { ok: false, response: jsonError("Некорректное значение enabled.") };
    const roleId = value.roleId ?? null;
    if (roleId !== null && (typeof roleId !== "string" || !isSnowflake(roleId))) return { ok: false, response: jsonError("Некорректный ID роли.") };
    return { ok: true, value: { enabled: value.enabled, roleId } };
  },
  view: autoroleView,
  save: (guildId, state) => {
    const row = fromAutoroleDto(state);
    stmt.autoroleUpsert.run({ guild_id: guildId, enabled: row.enabled, role_id: row.role_id, updated_at: Date.now() });
    invalidateAutoroleSettings(guildId);
  },
  section: AUDIT_SECTION.roles,
  prefix: "Автороль при входе: ",
});
