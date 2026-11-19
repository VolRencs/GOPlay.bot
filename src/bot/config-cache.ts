import { stmt } from "../db/statements.ts";
import { logger } from "../lib/logger.ts";
import { safeJson, parseStringArray } from "../lib/json.ts";
import { ttlCacheSync } from "../lib/cache.ts";
import { invalidateGuildLang } from "../lib/i18n/bot.ts";
import { invalidateAutoroleSettings } from "../lib/autorole.ts";
import { invalidateMusicSettings } from "../lib/music-settings.ts";
import { invalidateWelcomeSettings } from "./welcome.ts";
import type { Rule } from "./automod/detectors.ts";

export type CachedRule = {
  kind: Rule["kind"];
  action_json: string;
  threshold: Record<string, unknown> | null;
  window_seconds: number;
  escalation: number;
};

type CachedRules = {
  rules: CachedRule[];
  ignoredRoles: string[];
  protectedChannelId: string | null;
};

const SNAPSHOT_TTL = 60_000;
const VERSION_CHECK_MS = 1_000;

const snapshots = ttlCacheSync<string, CachedRules>((guildId) => {
  const rules = stmt.rules.all(guildId).map(({ threshold_json, ...row }) => ({ ...row, threshold: safeJson<Record<string, unknown> | null>(threshold_json, null) }));
  const security = stmt.security.get(guildId);
  return { rules, ignoredRoles: parseStringArray(security?.ignored_role_ids_json), protectedChannelId: security?.protected_channel_id ?? null };
}, SNAPSHOT_TTL);
let lastDataVersion = -1;
let lastVersionCheck = 0;
let dataVersionFailures = 0;

const PANEL_TTL = 10_000;
type ReactionPanel = { id: number; role_mode: string; options: { role_id: string; emoji: string | null }[] };
const reactionPanelCache = ttlCacheSync<string, Map<string, ReactionPanel>>((guildId) => {
  const panels = new Map<string, ReactionPanel>();
  for (const row of stmt.panelReactions.all(guildId)) {
    const panel = panels.getOrInsertComputed(row.message_id, () => ({ id: row.id, role_mode: row.role_mode, options: [] }));
    if (row.role_id !== null) panel.options.push({ role_id: row.role_id, emoji: row.emoji });
  }
  return panels;
}, PANEL_TTL);

type CachedPanel = {
  role_limit: number;
  role_mode: string;
  notify_enabled: number;
  notify_template: string;
  options: { role_id: string; emoji: string | null }[];
};

const panelInfoCache = ttlCacheSync<string, CachedPanel | null>((key) => {
  const separator = key.indexOf(":");
  const guildId = key.slice(0, separator);
  const panelId = Number(key.slice(separator + 1));
  const panel = stmt.panel.get(panelId, guildId);
  return panel ? { ...panel, options: stmt.panelOptionEmoji.all(panelId) } : null;
}, PANEL_TTL);

function syncCaches(): void {
  const now = Date.now();
  if (now - lastVersionCheck < VERSION_CHECK_MS) return;
  lastVersionCheck = now;
  try {
    const version = stmt.dataVersion.get()!.data_version;
    dataVersionFailures = 0;
    if (version === lastDataVersion) return;
    lastDataVersion = version;
    snapshots.clear();
    panelInfoCache.clear();
    reactionPanelCache.clear();
  } catch (error) {
    dataVersionFailures = logger.warnEvery(dataVersionFailures, 60, "[CONFIG] Не удалось проверить версию данных", error);
  }
}

export function cachedRules(guildId: string): CachedRules {
  syncCaches();
  try {
    return snapshots.get(guildId);
  } catch (error) {
    logger.warn("[CONFIG] Не удалось обновить конфигурацию автомода", guildId, error);
    return { rules: [], ignoredRoles: [], protectedChannelId: null };
  }
}

export function cachedPanel(guildId: string, panelId: number): CachedPanel | null {
  syncCaches();
  return panelInfoCache.get(`${guildId}:${panelId}`);
}

export function reactionPanel(guildId: string, messageId: string): ReactionPanel | undefined {
  syncCaches();
  return reactionPanelCache.get(guildId).get(messageId);
}

export function invalidateReactionPanels(guildId: string) {
  reactionPanelCache.delete(guildId);
  panelInfoCache.clear();
}

export function purgeConfigCaches(guildId: string) {
  snapshots.delete(guildId);
  reactionPanelCache.delete(guildId);
  panelInfoCache.clear();
  invalidateAutoroleSettings(guildId);
  invalidateGuildLang(guildId);
  invalidateMusicSettings(guildId);
  invalidateWelcomeSettings(guildId);
}
