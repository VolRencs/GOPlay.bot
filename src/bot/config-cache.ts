import { stmt } from "./db/statements.ts";
import { logger } from "./utils/logger.ts";
import { safeJson, parseStringArray } from "../lib/json.ts";
import { ttlCacheSync } from "../lib/cache.ts";
import { guildLang } from "../lib/i18n/bot.ts";
import type { Rule } from "./automod/detectors.ts";

export type CachedRule = {
  kind: Rule["kind"];
  enabled: number;
  action_json: string;
  threshold_json: string;
  /** Пороги, распарсенные ОДИН раз при загрузке снапшота: на каждое сообщение
   *  сервера раньше приходился JSON.parse на каждое правило (горячий путь). */
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

const REFRESH_INTERVAL = 1_000;
const IDLE_TIMEOUT = 60_000;

const snapshots = new Map<string, CachedRules>();
const activeGuilds = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | null = null;
let lastDataVersion = -1;
let dataVersionFailures = 0;

function load(guildId: string): CachedRules {
  const rules = (stmt.rules.all(guildId) as CachedRule[]).map(row => ({ ...row, threshold: safeJson<Record<string, unknown> | null>(row.threshold_json, null) }));
  const security = stmt.security.get(guildId) as { ignored_role_ids_json: string; protected_channel_id: string | null } | undefined;
  return { rules, ignoredRoles: parseStringArray(security?.ignored_role_ids_json), protectedChannelId: security?.protected_channel_id ?? null, lang: guildLang(guildId) };
}

function refreshGuild(guildId: string) {
  try {
    snapshots.set(guildId, load(guildId));
  } catch (error) {
    logger.warn("[CONFIG] Не удалось обновить конфигурацию автомода", guildId, error);
  }
}

export function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}

function ensureTimer() {
  if (!timer) { timer = setInterval(refreshLoop, REFRESH_INTERVAL); timer.unref?.(); }
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
    version = (stmt.dataVersion.get() as { data_version: number }).data_version;
    dataVersionFailures = 0;
  } catch (error) {
    dataVersionFailures += 1;
    if (dataVersionFailures === 1 || dataVersionFailures % 60 === 0)
      logger.warn("[CONFIG] Не удалось проверить версию данных", error, `повтор #${dataVersionFailures}`);
  }
  if (version === lastDataVersion) return;
  lastDataVersion = version;
  for (const guildId of snapshots.keys()) refreshGuild(guildId);
}

export function cachedRules(guildId: string): CachedRules {
  activeGuilds.set(guildId, Date.now());
  ensureTimer();
  let snapshot = snapshots.get(guildId);
  if (!snapshot) {
    try {
      snapshot = load(guildId);
    } catch (error) {
      logger.warn("[CONFIG] Не удалось загрузить конфигурацию автомода", guildId, error);
      snapshot = { rules: [], ignoredRoles: [], protectedChannelId: null, lang: "ru" as const };
    }
    snapshots.set(guildId, snapshot);
  }
  return snapshot;
}

export function seedRules(guildId: string) {
  if (snapshots.has(guildId)) return;
  try {
    snapshots.set(guildId, load(guildId));
  } catch (error) {
    logger.warn("[CONFIG] Не удалось загрузить конфигурацию автомода", guildId, error);
  }
}

const PANEL_TTL = 10_000;
type ReactionPanel = { id: number; role_mode: string; options: { role_id: string; emoji: string | null }[] };
const reactionPanelCache = ttlCacheSync<string, Map<string, ReactionPanel>>((guildId) => {
  const panels = new Map<string, ReactionPanel>();
  for (const row of stmt.panelReactions.all(guildId) as { id: number; role_mode: string; message_id: string }[]) {
    panels.set(row.message_id, { id: row.id, role_mode: row.role_mode, options: stmt.panelOptionEmoji.all(row.id) as { role_id: string; emoji: string | null }[] });
  }
  return panels;
}, PANEL_TTL);

export function reactionPanel(guildId: string, messageId: string): ReactionPanel | undefined {
  return reactionPanelCache.get(guildId).get(messageId);
}

export function invalidateReactionPanels(guildId: string) { reactionPanelCache.delete(guildId); }

export function purgeGuild(guildId: string) {
  snapshots.delete(guildId);
  activeGuilds.delete(guildId);
  reactionPanelCache.delete(guildId);
}