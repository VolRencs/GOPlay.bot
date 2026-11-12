import { stmt } from "../db/statements.ts";
import { logger } from "../lib/logger.ts";
import { safeJson, parseStringArray } from "../lib/json.ts";
import { ttlCacheSync } from "../lib/cache.ts";
import { guildLang, invalidateGuildLang } from "../lib/i18n/bot.ts";
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
  lang: "ru" | "en";
  rules: CachedRule[];
  ignoredRoles: string[];
  protectedChannelId: string | null;
};

const REFRESH_INTERVAL = 5_000;
const IDLE_TIMEOUT = 60_000;

const snapshots = new Map<string, CachedRules>();
const activeGuilds = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | null = null;
let lastDataVersion = -1;
let dataVersionFailures = 0;

function load(guildId: string): CachedRules {
  const rules = stmt.rules.all(guildId).map(({ threshold_json, ...row }) => ({ ...row, threshold: safeJson<Record<string, unknown> | null>(threshold_json, null) }));
  const security = stmt.security.get(guildId);
  return { rules, ignoredRoles: parseStringArray(security?.ignored_role_ids_json), protectedChannelId: security?.protected_channel_id ?? null, lang: guildLang(guildId) };
}

function refreshGuild(guildId: string): CachedRules | null {
  try {
    const snapshot = load(guildId);
    snapshots.set(guildId, snapshot);
    return snapshot;
  } catch (error) {
    logger.warn("[CONFIG] Не удалось обновить конфигурацию автомода", guildId, error);
    return null;
  }
}

export function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}

function ensureTimer() {
  if (!timer) { timer = setInterval(refreshLoop, REFRESH_INTERVAL).unref(); }
}

function refreshLoop() {
  const now = Date.now();
  for (const [guildId, lastActive] of activeGuilds) {
    if (now - lastActive > IDLE_TIMEOUT) {
      activeGuilds.delete(guildId);
      snapshots.delete(guildId);
    }
  }
  if (!snapshots.size) stopTimer();
  let version = lastDataVersion;
  try {
    version = stmt.dataVersion.get()!.data_version;
    dataVersionFailures = 0;
  } catch (error) {
    dataVersionFailures = logger.warnEvery(dataVersionFailures, 60, "[CONFIG] Не удалось проверить версию данных", error);
  }
  if (version === lastDataVersion) return;
  lastDataVersion = version;
  for (const guildId of snapshots.keys()) refreshGuild(guildId);
}

export function cachedRules(guildId: string): CachedRules {
  activeGuilds.set(guildId, Date.now());
  ensureTimer();
  return snapshots.get(guildId)
    ?? refreshGuild(guildId)
    ?? { rules: [], ignoredRoles: [], protectedChannelId: null, lang: "ru" as const };
}

const PANEL_TTL = 10_000;
type ReactionPanel = { id: number; role_mode: string; options: { role_id: string; emoji: string | null }[] };
const reactionPanelCache = ttlCacheSync<string, Map<string, ReactionPanel>>((guildId) => {
  const panels = new Map<string, ReactionPanel>();
  for (const row of stmt.panelReactions.all(guildId)) {
    let panel = panels.get(row.message_id);
    if (!panel) {
      panel = { id: row.id, role_mode: row.role_mode, options: [] };
      panels.set(row.message_id, panel);
    }
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

export function cachedPanel(guildId: string, panelId: number): CachedPanel | null {
  return panelInfoCache.get(`${guildId}:${panelId}`);
}

export function reactionPanel(guildId: string, messageId: string): ReactionPanel | undefined {
  return reactionPanelCache.get(guildId).get(messageId);
}

export function invalidateReactionPanels(guildId: string) { reactionPanelCache.delete(guildId); }

export function purgeConfigCaches(guildId: string) {
  snapshots.delete(guildId);
  activeGuilds.delete(guildId);
  reactionPanelCache.delete(guildId);
  invalidateAutoroleSettings(guildId);
  invalidateGuildLang(guildId);
  invalidateMusicSettings(guildId);
  invalidateWelcomeSettings(guildId);
}
