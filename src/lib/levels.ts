// Система уровней (/lvl, /top): чистые типы, дефолты и формула, безопасные для
// клиентского бандла (панель импортирует их напрямую). Доступ к БД — в
// levels-store.ts, чтобы node:sqlite не попадал в браузер.
// Уровень — производная от XP: need(1) = base_xp,
// need(n+1) = need(n) × (1 + growth_percent/100), порог накапливается.

export const notifyModes = ["off", "dm", "channel"] as const;
export type NotifyMode = (typeof notifyModes)[number];

export type LevelSettings = {
  enabled: boolean;
  xp_per_message: number;
  message_cooldown_seconds: number;
  min_message_length: number;
  xp_per_voice_minute: number;
  base_xp: number;
  growth_percent: number;
  ignored_channel_ids: string[];
  ignored_role_ids: string[];
  notify_mode: NotifyMode;
  notify_channel_id: string | null;
};

export type LevelReward = { level: number; role_id: string };
export type LevelsGet = { settings: LevelSettings; rewards: LevelReward[] };
export type LevelsPutBody = LevelsGet;

export const levelRanges = {
  xp_per_message: { min: 0, max: 100 },
  message_cooldown_seconds: { min: 0, max: 3600 },
  min_message_length: { min: 0, max: 200 },
  xp_per_voice_minute: { min: 0, max: 100 },
  base_xp: { min: 10, max: 100_000 },
  growth_percent: { min: 0, max: 100 },
} as const;

export const MAX_LEVEL = 1000;
export const MAX_REWARDS = 100;

export const levelDefaults: LevelSettings = {
  enabled: false,
  xp_per_message: 10,
  message_cooldown_seconds: 60,
  min_message_length: 0,
  xp_per_voice_minute: 5,
  base_xp: 100,
  growth_percent: 15,
  ignored_channel_ids: [],
  ignored_role_ids: [],
  notify_mode: "channel",
  notify_channel_id: null,
};

/** Суммарный XP, необходимый для достижения уровня (0 → 0). */
export function xpForLevel(level: number, baseXp: number, growthPercent: number): number {
  let total = 0;
  let need = baseXp;
  for (let current = 1; current <= level && current <= MAX_LEVEL; current++) {
    total += need;
    need = Math.round(need * (1 + growthPercent / 100));
  }
  return total;
}

export function levelFromXp(xp: number, baseXp: number, growthPercent: number): number {
  let total = 0;
  let need = baseXp;
  for (let level = 1; level <= MAX_LEVEL; level++) {
    total += need;
    if (xp < total) return level - 1;
    need = Math.round(need * (1 + growthPercent / 100));
  }
  return MAX_LEVEL;
}

export function levelProgress(xp: number, baseXp: number, growthPercent: number): { level: number; current: number; needed: number } {
  const level = levelFromXp(xp, baseXp, growthPercent);
  if (level >= MAX_LEVEL) return { level, current: 0, needed: 0 };
  const floor = xpForLevel(level, baseXp, growthPercent);
  const next = xpForLevel(level + 1, baseXp, growthPercent);
  return { level, current: xp - floor, needed: next - floor };
}

export function buildLevelsPutBody(settings: LevelSettings, rewards: LevelReward[]): LevelsPutBody {
  return {
    settings: {
      ...settings,
      ignored_channel_ids: [...settings.ignored_channel_ids],
      ignored_role_ids: [...settings.ignored_role_ids],
    },
    rewards: rewards.map(reward => ({ level: reward.level, role_id: reward.role_id })).sort((a, b) => a.level - b.level),
  };
}
