import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
import { autoroleSettingsFor, invalidateAutoroleSettings, type AutoroleGet, type AutorolePutBody } from "../../../../../src/lib/autorole.ts";
import { recordDashboardDiff } from "../../../../../src/lib/dashboard-audit.ts";
import { stmt } from "../../../../../src/bot/db/statements.ts";
import { safeJson } from "../../../../../src/lib/json.ts";

const roleRef = (id: string) => `<@&${id}>`;

export const GET = guildRoute(async (_, { guildId }) => {
  return NextResponse.json<AutoroleGet>(autoroleSettingsFor(guildId));
});

export const PUT = guildRoute(async (request, { guildId, user }) => {
  const body = await readJson<AutorolePutBody>(request);
  if (!body) return jsonError("Некорректное тело запроса.");
  if (typeof body.enabled !== "boolean") return jsonError("Некорректное значение enabled.");
  const roleIds = body.roleIds ?? [];
  if (!Array.isArray(roleIds)) return jsonError("Некорректный список ролей.");
  if (!roleIds.every(id => isSnowflake(id))) return jsonError("Некорректный ID роли.");
  const unique = [...new Set(roleIds)];
  const current = stmt.autoroleSettings.get(guildId) as { enabled: number; role_ids_json: string } | undefined;
  const nextEnabled = body.enabled;
  const nextRoleIdsJson = JSON.stringify(unique);
  if (current && Boolean(current.enabled) === nextEnabled && current.role_ids_json === nextRoleIdsJson) {
    return NextResponse.json({ ok: true, unchanged: true });
  }
  stmt.autoroleUpsert.run(guildId, +nextEnabled, nextRoleIdsJson, Date.now());
  invalidateAutoroleSettings(guildId);
  recordDashboardDiff(guildId, user, "Роли", "Автороль при входе: ",
    {
      "Включено": Boolean(current?.enabled),
      "Роли": current ? safeJson<string[]>(current.role_ids_json, []).map(roleRef) : [],
    },
    {
      "Включено": nextEnabled,
      "Роли": unique.map(roleRef),
    });
  return NextResponse.json({ ok: true });
});