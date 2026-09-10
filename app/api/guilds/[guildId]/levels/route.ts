import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, isSnowflakeArray, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
import { withTransaction } from "../../../../../src/db/database.ts";
import { stmt } from "../../../../../src/bot/db/statements.ts";
import { stableJson } from "../../../../../src/lib/json.ts";
import { MAX_LEVEL, MAX_REWARDS, levelRanges, notifyModes, type LevelReward, type LevelSettings, type LevelsGet, type NotifyMode } from "../../../../../src/lib/levels.ts";
import { levelRewardsFor, levelSettingsFor } from "../../../../../src/lib/levels-store.ts";
import { recordDashboardChange } from "../../../../../src/lib/dashboard-audit.ts";

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
  for (const [key, range] of Object.entries(levelRanges)) {
    const value = s[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < range.min || value > range.max) {
      return jsonError("Некорректные числовые настройки уровней.");
    }
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
    if (!Number.isInteger(reward.level) || (reward.level as number) < 1 || (reward.level as number) > MAX_LEVEL) return jsonError("Некорректный уровень награды.");
    if (typeof reward.role_id !== "string" || !isSnowflake(reward.role_id)) return jsonError("Некорректная роль награды.");
    if (levels.has(reward.level as number)) return jsonError("На один уровень можно назначить только одну роль.");
    levels.add(reward.level as number);
    rewards.push({ level: reward.level as number, role_id: reward.role_id });
  }
  rewards.sort((a, b) => a.level - b.level);

  const settings: LevelSettings = {
    enabled: s.enabled,
    xp_per_message: s.xp_per_message as number,
    message_cooldown_seconds: s.message_cooldown_seconds as number,
    min_message_length: s.min_message_length as number,
    xp_per_voice_minute: s.xp_per_voice_minute as number,
    base_xp: s.base_xp as number,
    growth_percent: s.growth_percent as number,
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
  recordDashboardChange(guildId, user, "Уровни", `Система уровней ${settings.enabled ? "включена" : "выключена"} · XP: ${settings.xp_per_message}/сообщение, ${settings.xp_per_voice_minute}/мин голоса · наград: ${rewards.length}`);
  return NextResponse.json({ ok: true });
});
