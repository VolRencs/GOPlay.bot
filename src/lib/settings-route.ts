import { NextResponse } from "next/server.js";
import { guildRoute, readJson } from "./guild-access.ts";
import { recordDashboardDiff } from "./dashboard-audit.ts";
import { stableJson } from "./json.ts";

type Loaded<T> = { state: T; exists: boolean };
type ParseResult<T> = { ok: true; value: T } | { ok: false; response: Response };

type SettingsPutConfig<T> = {
  load(guildId: string): Loaded<T>;
  parse(body: unknown, guildId: string, current: T): ParseResult<T>;
  view(state: T): Record<string, unknown>;
  save(guildId: string, state: T): void;
  section: string;
  prefix: string;
  opaque?: Record<string, string>;
  saveMissing?: boolean;
};

export function settingsGetRoute<T>(load: (guildId: string) => T) {
  return guildRoute(async (_, { guildId }) => NextResponse.json(load(guildId)));
}

export function settingsPutRoute<T>(config: SettingsPutConfig<T>) {
  return guildRoute(async (request, { guildId, user }) => {
    const current = config.load(guildId);
    const parsed = config.parse(await readJson<unknown>(request), guildId, current.state);
    if (!parsed.ok) return parsed.response;
    const next = parsed.value;
    const before = config.view(current.state);
    const after = config.view(next);
    if ((current.exists || !config.saveMissing) && stableJson(before) === stableJson(after)) {
      return NextResponse.json({ ok: true, unchanged: true });
    }
    config.save(guildId, next);
    recordDashboardDiff(guildId, user, config.section, config.prefix, before, after, config.opaque);
    return NextResponse.json({ ok: true });
  });
}
