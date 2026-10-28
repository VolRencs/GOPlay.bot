import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
import { autoroleSettingsFor, invalidateAutoroleSettings, type AutoroleGet, type AutorolePutBody } from "../../../../../src/lib/autorole.ts";
import { recordDashboardDiff } from "../../../../../src/lib/dashboard-audit.ts";
import { AUDIT_SECTION } from "../../../../../src/lib/audit-sections.ts";
import { stmt } from "../../../../../src/db/statements.ts";
import { roleRef } from "../../../../../src/lib/mentions.ts";

export const GET = guildRoute(async (_, { guildId }) => {
  return NextResponse.json<AutoroleGet>(autoroleSettingsFor(guildId));
});

export const PUT = guildRoute(async (request, { guildId, user }) => {
  const body = await readJson<AutorolePutBody>(request);
  if (!body) return jsonError("Некорректное тело запроса.");
  if (typeof body.enabled !== "boolean") return jsonError("Некорректное значение enabled.");
  const roleId = body.roleId ?? null;
  if (roleId !== null && !isSnowflake(roleId)) return jsonError("Некорректный ID роли.");

  const current = stmt.autoroleSettings.get(guildId) as { enabled: number; role_id: string | null } | undefined;
  const nextEnabled = body.enabled;
  if (current && Boolean(current.enabled) === nextEnabled && (current.role_id ?? null) === roleId) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  stmt.autoroleUpsert.run(guildId, +nextEnabled, roleId, Date.now());
  invalidateAutoroleSettings(guildId);

  recordDashboardDiff(guildId, user, AUDIT_SECTION.roles, "Автороль при входе: ",
    {
      "Включено": Boolean(current?.enabled),
      "Роль": current?.role_id ? roleRef(current.role_id) : null,
    },
    {
      "Включено": nextEnabled,
      "Роль": roleId ? roleRef(roleId) : null,
    });
  return NextResponse.json({ ok: true });
});
