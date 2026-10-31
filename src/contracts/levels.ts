import { levelDefaults, levelRanges, type LevelReward, type LevelSettings, type NotifyMode } from "../lib/levels.ts";

export type LevelSettingsDto = {
  enabled: boolean;
  xpPerMessage: number;
  messageCooldownSeconds: number;
  minMessageLength: number;
  xpPerVoiceMinute: number;
  baseXp: number;
  growthPercent: number;
  ignoredChannelIds: string[];
  ignoredRoleIds: string[];
  notifyMode: NotifyMode;
  notifyChannelId: string | null;
};

export type LevelRewardDto = { level: number; roleId: string };

export type LevelsDto = { settings: LevelSettingsDto; rewards: LevelRewardDto[] };

export type LevelsDomain = { settings: LevelSettings; rewards: LevelReward[] };

export const levelRangesDto = {
  xpPerMessage: levelRanges.xp_per_message,
  messageCooldownSeconds: levelRanges.message_cooldown_seconds,
  minMessageLength: levelRanges.min_message_length,
  xpPerVoiceMinute: levelRanges.xp_per_voice_minute,
  baseXp: levelRanges.base_xp,
  growthPercent: levelRanges.growth_percent,
} as const;

export const levelDefaultsDto: LevelSettingsDto = {
  enabled: levelDefaults.enabled,
  xpPerMessage: levelDefaults.xp_per_message,
  messageCooldownSeconds: levelDefaults.message_cooldown_seconds,
  minMessageLength: levelDefaults.min_message_length,
  xpPerVoiceMinute: levelDefaults.xp_per_voice_minute,
  baseXp: levelDefaults.base_xp,
  growthPercent: levelDefaults.growth_percent,
  ignoredChannelIds: [...levelDefaults.ignored_channel_ids],
  ignoredRoleIds: [...levelDefaults.ignored_role_ids],
  notifyMode: levelDefaults.notify_mode,
  notifyChannelId: levelDefaults.notify_channel_id,
};

export function toDto(domain: LevelsDomain): LevelsDto {
  return {
    settings: {
      enabled: domain.settings.enabled,
      xpPerMessage: domain.settings.xp_per_message,
      messageCooldownSeconds: domain.settings.message_cooldown_seconds,
      minMessageLength: domain.settings.min_message_length,
      xpPerVoiceMinute: domain.settings.xp_per_voice_minute,
      baseXp: domain.settings.base_xp,
      growthPercent: domain.settings.growth_percent,
      ignoredChannelIds: [...domain.settings.ignored_channel_ids],
      ignoredRoleIds: [...domain.settings.ignored_role_ids],
      notifyMode: domain.settings.notify_mode,
      notifyChannelId: domain.settings.notify_channel_id,
    },
    rewards: domain.rewards.map(reward => ({ level: reward.level, roleId: reward.role_id })).toSorted((a, b) => a.level - b.level),
  };
}

export function normalize(dto: LevelsDto): LevelsDto {
  return toDto(fromDto(dto));
}

export function fromDto(dto: LevelsDto): LevelsDomain {
  return {
    settings: {
      enabled: dto.settings.enabled,
      xp_per_message: dto.settings.xpPerMessage,
      message_cooldown_seconds: dto.settings.messageCooldownSeconds,
      min_message_length: dto.settings.minMessageLength,
      xp_per_voice_minute: dto.settings.xpPerVoiceMinute,
      base_xp: dto.settings.baseXp,
      growth_percent: dto.settings.growthPercent,
      ignored_channel_ids: [...dto.settings.ignoredChannelIds],
      ignored_role_ids: [...dto.settings.ignoredRoleIds],
      notify_mode: dto.settings.notifyMode,
      notify_channel_id: dto.settings.notifyChannelId,
    },
    rewards: dto.rewards.map(reward => ({ level: reward.level, role_id: reward.roleId })).toSorted((a, b) => a.level - b.level),
  };
}
