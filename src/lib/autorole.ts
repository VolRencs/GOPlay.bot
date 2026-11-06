import { stmt } from "../db/statements.ts";
import { ttlCacheSync } from "./cache.ts";
import { toAutoroleDto, type AutoroleDto } from "../contracts/roles.ts";

function loadAutorole(guildId: string): AutoroleDto {
  const row = stmt.autoroleSettings.get(guildId);
  return toAutoroleDto({ enabled: row?.enabled ?? 0, role_id: row?.role_id ?? null });
}

const cache = ttlCacheSync<string, AutoroleDto>(loadAutorole, 10_000);

export function autoroleSettingsFor(guildId: string): AutoroleDto {
  return cache.get(guildId);
}

export function invalidateAutoroleSettings(guildId: string): void {
  cache.delete(guildId);
}
