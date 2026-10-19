import { stmt } from "../db/statements.ts";
import { ttlCacheSync } from "./cache.ts";

export type AutoroleGet = { enabled: boolean; roleId: string | null };

export type AutorolePutBody = { enabled: boolean; roleId: string | null };

function loadAutorole(guildId: string): AutoroleGet {
  const row = stmt.autoroleSettings.get(guildId) as { enabled: number; role_id: string | null } | undefined;
  return {
    enabled: Boolean(row?.enabled),
    roleId: row?.role_id ?? null,
  };
}

const cache = ttlCacheSync<string, AutoroleGet>(loadAutorole, 10_000);

export function autoroleSettingsFor(guildId: string): AutoroleGet {
  return cache.get(guildId);
}

export function invalidateAutoroleSettings(guildId: string): void {
  cache.delete(guildId);
}
