import { stmt } from "../bot/db/statements.ts";
import { ttlCacheSync } from "./cache.ts";
import { parseStringArray } from "./json.ts";

export type AutoroleGet = { enabled: boolean; roleIds: string[] };

export type AutorolePutBody = { enabled: boolean; roleIds: string[] };

function loadAutorole(guildId: string): AutoroleGet {
  const row = stmt.autoroleSettings.get(guildId) as { enabled: number; role_ids_json: string } | undefined;
  return {
    enabled: Boolean(row?.enabled),
    roleIds: parseStringArray(row?.role_ids_json),
  };
}

const cache = ttlCacheSync<string, AutoroleGet>(loadAutorole, 10_000);

export function autoroleSettingsFor(guildId: string): AutoroleGet {
  return cache.get(guildId);
}

export function invalidateAutoroleSettings(guildId: string): void {
  cache.delete(guildId);
}