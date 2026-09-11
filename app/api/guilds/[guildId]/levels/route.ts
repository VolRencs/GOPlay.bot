import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, isSnowflakeArray, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
import { withTransaction } from "../../../../../src/db/database.ts";
import { stmt } from "../../../../../src/bot/db/statements.ts";
import { stableJson } from "../../../../../src/lib/json.ts";
import { MAX_LEVEL, MAX_REWARDS, levelRanges, notifyModes, type LevelReward, type LevelSettings, type LevelsGet, type NotifyMode } from "../../../../../src/lib/levels.ts";
import { levelRewardsFor, levelSettingsFor } from "../../../../../src/lib/levels-store.ts";
import { recordDashboardDiff } from "../../../../../src/lib/dashboard-audit.ts";

const notifyModeLabels: Record<NotifyMode, string> = { off: "выключены", dm: "в личные сообщения", channel: "в канал" };

export const GET = guildRoute(async (_, { guildId }) => {
  return NextResponse.json<LevelsGet>({ settings: levelSettingsFor(guildId), rewards: levelRewardsFor(guildId) });
});

export const PUT = guildRoute(async (request, { guildId, user }) => {
  const body = await readJson<unknown>(request);
  if (!body || typeof body !== "object") return jsonError("Некорректный запрос.");
  const raw = body as { settings?: unknown; rewards?: unknown };
  if (!raw.settings || typeof raw.settings !== "object" || Array.isArray(raw.settings)) return jsonError("Некорректные настройки уровней.");
  const s = raw.settings as Record<string, unknown>;
  if (typeof s.enabled !== "boolean") return jsonError("Некорректное состояние системы уровней.");
  const numbers = {} as Record<keyof typeof levelRanges, number>;
  for (const key of Object.keys(levelRanges) as (keyof typeof levelRanges)[]) {
    const value = s[key];
    const range = levelRanges[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < range.min || value > range.max) {
      return jsonError("Некорректные числовые настройки уровней.");
    }
    numbers[key] = value;
  }
  if (!notifyModes.includes(s.notify_mode as NotifyMode)) return jsonError("Некорректный режим уведомлений.");
  const notifyMode = s.notify_mode as NotifyMode;
  const notifyChannelId = s.notify_channel_id ?? null;
  if (notifyChannelId !== null && (typeof notifyChannelId !== "string" || !isSnowflake(notifyChannelId))) return jsonError("Некорректный канал уведомлений.");
  if (s.enabled && notifyMode === "channel" && !notifyChannelId) return jsonError("Выберите канал для уведомлений о новом уровне.");
  const ignoredChannels = s.ignored_channel_ids ?? [];
  const ignoredRoles = s.ignored_role_ids ?? [];
  if (!isSnowflakeArray(ignoredChannels) || !isSnowflakeArray(ignoredRoles)) return jsonError("Некорректные исключения каналов или ролей.");
  if (!Array.isArray(raw.rewards) || raw.rewards.length > MAX_REWARDS) return jsonError("Некорректный список наград.");
  const rewards: LevelReward[] = [];
  const levels = new Set<number>();
  for (const entry of raw.rewards) {
    if (!entry || typeof entry !== "object") return jsonError("Некорректная награда за уровень.");
    const reward = entry as Record<string, unknown>;
    const level = reward.level;
    if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return jsonError("Некорректный уровень награды.");
    if (typeof reward.role_id !== "string" || !isSnowflake(reward.role_id)) return jsonError("Некорректная роль награды.");
    if (levels.has(level)) return jsonError("На один уровень можно назначить только одну роль.");
    levels.add(level);
    rewards.push({ level, role_id: reward.role_id });
  }
  rewards.sort((a, b) => a.level - b.level);

  const settings: LevelSettings = {
    enabled: s.enabled,
    xp_per_message: numbers.xp_per_message,
    message_cooldown_seconds: numbers.message_cooldown_seconds,
    min_message_length: numbers.min_message_length,
    xp_per_voice_minute: numbers.xp_per_voice_minute,
    base_xp: numbers.base_xp,
    growth_percent: numbers.growth_percent,
    ignored_channel_ids: [...ignoredChannels],
    ignored_role_ids: [...ignoredRoles],
    notify_mode: notifyMode,
    notify_channel_id: notifyChannelId,
  };
  const current = { settings: levelSettingsFor(guildId), rewards: levelRewardsFor(guildId) };
  // Награды обеих сторон упорядочены по уровню, строковые массивы stableJson
  // сортирует сам — порядок исключений на каноничность не влияет.
  if (stableJson(current) === stableJson({ settings, rewards })) return NextResponse.json({ ok: true, unchanged: true });

  withTransaction(() => {
    stmt.levelSettingsUpsert.run(guildId, +settings.enabled, settings.xp_per_message, settings.message_cooldown_seconds, settings.min_message_length, settings.xp_per_voice_minute, settings.base_xp, settings.growth_percent, JSON.stringify(settings.ignored_channel_ids), JSON.stringify(settings.ignored_role_ids), settings.notify_mode, settings.notify_channel_id, Date.now());
    stmt.levelRewardsDelete.run(guildId);
    for (const reward of rewards) stmt.levelRewardsInsert.run(guildId, reward.level, reward.role_id);
  });
  recordDashboardDiff(guildId, user, "Уровни", "Система уровней: ",
    {
      "Система уровней": current.settings.enabled,
      "XP за сообщение": current.settings.xp_per_message,
      "Кулдаун сообщений, с": current.settings.message_cooldown_seconds,
      "Мин. длина сообщения": current.settings.min_message_length,
      "XP за минуту голоса": current.settings.xp_per_voice_minute,
      "Базовый XP": current.settings.base_xp,
      "Рост, %": current.settings.growth_percent,
      "Исключённые каналы": current.settings.ignored_channel_ids.map(id => `<#${id}>`),
      "Исключённые роли": current.settings.ignored_role_ids.map(id => `<@&${id}>`),
      "Уведомления": notifyModeLabels[current.settings.notify_mode],
      "Канал уведомлений": current.settings.notify_channel_id ? `<#${current.settings.notify_channel_id}>` : null,
      "Награды": current.rewards.map(reward => `ур. ${reward.level} → <@&${reward.role_id}>`),
    },
    {
      "Система уровней": settings.enabled,
      "XP за сообщение": settings.xp_per_message,
      "Кулдаун сообщений, с": settings.message_cooldown_seconds,
      "Мин. длина сообщения": settings.min_message_length,
      "XP за минуту голоса": settings.xp_per_voice_minute,
      "Базовый XP": settings.base_xp,
      "Рост, %": settings.growth_percent,
      "Исключённые каналы": settings.ignored_channel_ids.map(id => `<#${id}>`),
      "Исключённые роли": settings.ignored_role_ids.map(id => `<@&${id}>`),
      "Уведомления": notifyModeLabels[settings.notify_mode],
      "Канал уведомлений": settings.notify_channel_id ? `<#${settings.notify_channel_id}>` : null,
      "Награды": rewards.map(reward => `ур. ${reward.level} → <@&${reward.role_id}>`),
    });
  return NextResponse.json({ ok: true });
});
