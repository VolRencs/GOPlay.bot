import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, isSnowflakeArray, jsonError } from "#lib/guild-access.ts";
import { withTransaction } from "#db/database.ts";
import { stmt } from "#db/statements.ts";
import { MAX_LEVEL, MAX_REWARDS, notifyModes } from "#lib/levels.ts";
import { settingsPutRoute } from "#lib/settings-route.ts";
import { levelsState, levelsView } from "#lib/settings-views.ts";
import { fromDto as fromLevelsDto, levelRangesDto, type LevelRewardDto, type LevelsDto } from "#contracts/levels.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";

export const GET = guildRoute(async (_, { guildId }) => {
  return NextResponse.json<LevelsDto>(levelsState(guildId).state);
});

export const PUT = settingsPutRoute<LevelsDto>({
  load: guildId => levelsState(guildId),
  parse: body => {
    if (!body || typeof body !== "object") return { ok: false, response: jsonError("Некорректный запрос.") };
    const raw = body as Partial<LevelsDto>;
    if (!raw.settings || typeof raw.settings !== "object" || Array.isArray(raw.settings)) return { ok: false, response: jsonError("Некорректные настройки уровней.") };
    const s = raw.settings as Partial<LevelsDto["settings"]>;
    if (typeof s.enabled !== "boolean") return { ok: false, response: jsonError("Некорректное состояние системы уровней.") };
    const numbers = {} as Record<keyof typeof levelRangesDto, number>;
    for (const key of Object.keys(levelRangesDto) as (keyof typeof levelRangesDto)[]) {
      const value = s[key];
      const range = levelRangesDto[key];
      if (typeof value !== "number" || !Number.isInteger(value) || value < range.min || value > range.max) {
        return { ok: false, response: jsonError("Некорректные числовые настройки уровней.") };
      }
      numbers[key] = value;
    }
    const notifyMode = notifyModes.find(value => value === s.notifyMode);
    if (!notifyMode) return { ok: false, response: jsonError("Некорректный режим уведомлений.") };
    const notifyChannelId = s.notifyChannelId ?? null;
    if (notifyChannelId !== null && (typeof notifyChannelId !== "string" || !isSnowflake(notifyChannelId))) return { ok: false, response: jsonError("Некорректный канал уведомлений.") };
    if (s.enabled && notifyMode === "channel" && !notifyChannelId) return { ok: false, response: jsonError("Выберите канал для уведомлений о новом уровне.") };
    const ignoredChannels = s.ignoredChannelIds ?? [];
    const ignoredRoles = s.ignoredRoleIds ?? [];
    if (!isSnowflakeArray(ignoredChannels) || !isSnowflakeArray(ignoredRoles)) return { ok: false, response: jsonError("Некорректные исключения каналов или ролей.") };
    if (!Array.isArray(raw.rewards) || raw.rewards.length > MAX_REWARDS) return { ok: false, response: jsonError("Некорректный список наград.") };
    const rewards: LevelRewardDto[] = [];
    const levels = new Set<number>();
    for (const entry of raw.rewards) {
      if (!entry || typeof entry !== "object") return { ok: false, response: jsonError("Некорректная награда за уровень.") };
      const reward = entry as Partial<LevelRewardDto>;
      const level = reward.level;
      if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return { ok: false, response: jsonError("Некорректный уровень награды.") };
      if (typeof reward.roleId !== "string" || !isSnowflake(reward.roleId)) return { ok: false, response: jsonError("Некорректная роль награды.") };
      if (levels.has(level)) return { ok: false, response: jsonError("На один уровень можно назначить только одну роль.") };
      levels.add(level);
      rewards.push({ level, roleId: reward.roleId });
    }
    rewards.sort((a, b) => a.level - b.level);

    return {
      ok: true,
      value: {
        settings: {
          enabled: s.enabled,
          xpPerMessage: numbers.xpPerMessage,
          messageCooldownSeconds: numbers.messageCooldownSeconds,
          minMessageLength: numbers.minMessageLength,
          xpPerVoiceMinute: numbers.xpPerVoiceMinute,
          baseXp: numbers.baseXp,
          growthPercent: numbers.growthPercent,
          ignoredChannelIds: [...ignoredChannels],
          ignoredRoleIds: [...ignoredRoles],
          notifyMode,
          notifyChannelId,
        },
        rewards,
      },
    };
  },
  view: levelsView,
  save: (guildId, state) => {
    const domain = fromLevelsDto(state);
    withTransaction(() => {
      stmt.levelSettingsUpsert.run({
        guild_id: guildId,
        enabled: +domain.settings.enabled,
        xp_per_message: domain.settings.xp_per_message,
        message_cooldown_seconds: domain.settings.message_cooldown_seconds,
        min_message_length: domain.settings.min_message_length,
        xp_per_voice_minute: domain.settings.xp_per_voice_minute,
        base_xp: domain.settings.base_xp,
        growth_percent: domain.settings.growth_percent,
        ignored_channel_ids_json: JSON.stringify(domain.settings.ignored_channel_ids),
        ignored_role_ids_json: JSON.stringify(domain.settings.ignored_role_ids),
        notify_mode: domain.settings.notify_mode,
        notify_channel_id: domain.settings.notify_channel_id,
        updated_at: Date.now(),
      });
      stmt.levelRewardsDelete.run(guildId);
      for (const reward of domain.rewards) stmt.levelRewardsInsert.run(guildId, reward.level, reward.role_id);
    });
  },
  section: AUDIT_SECTION.levels,
  prefix: "Система уровней: ",
});
