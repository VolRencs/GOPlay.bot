import type { RuleKind } from "../lib/automod.ts";
import type { AppealStatus } from "../lib/appeals.ts";

export type GuildNameRow = { name: string };
export type GuildIdRow = { id: string };
export type CountRow = { count: number };
export type DataVersionRow = { data_version: number };

export type AutomodRuleCacheRow = {
  kind: RuleKind;
  action_json: string;
  threshold_json: string;
  window_seconds: number;
  escalation: number;
};

export type SecuritySettingsReadRow = {
  ignored_role_ids_json: string;
  protected_channel_id: string | null;
};

export type LoggingSettingsReadRow = {
  channel_id: string | null;
  categories_json: string;
};

export type TempChannelRow = {
  id: number;
  guild_id: string;
  channel_id: string;
  owner_id: string;
  panel_message_id: string | null;
  source_channel_id: string | null;
  created_at: number;
};

export type SelfRolePanelReadRow = {
  role_limit: number;
  role_mode: string;
  notify_enabled: number;
  notify_template: string;
};

export type SelfRoleOptionEmojiRow = { role_id: string; emoji: string | null };
export type MessageContentRow = { content: string };

export type ReactionPanelRow = { id: number; role_mode: string; message_id: string };

export type MusicSessionRow = {
  guild_id: string;
  channel_id: string;
  message_id: string;
  updated_at: number;
};

export type AutoroleSettingsRow = {
  guild_id: string;
  enabled: number;
  role_id: string | null;
  updated_at: number;
};

export type AutoroleSettingsReadRow = { enabled: number; role_id: string | null };

export type LevelSettingsRow = {
  guild_id: string;
  enabled: number;
  xp_per_message: number;
  message_cooldown_seconds: number;
  min_message_length: number;
  xp_per_voice_minute: number;
  base_xp: number;
  growth_percent: number;
  ignored_channel_ids_json: string;
  ignored_role_ids_json: string;
  notify_mode: string;
  notify_channel_id: string | null;
  updated_at: number;
};

export type MemberLevelRow = {
  guild_id: string;
  user_id: string;
  xp: number;
  level: number;
  messages: number;
  voice_seconds: number;
  updated_at: number;
};

export type LevelRankRow = { rank: number };
export type LevelTopRow = { user_id: string; xp: number };

export type AppealPunishmentRow = {
  id: number;
  guild_id: string;
  user_id: string;
  type: string;
  reason: string | null;
  created_at: number;
};

export type AppealRow = {
  id: number;
  number: number;
  guild_id: string;
  user_id: string;
  punishment_id: number;
  type: string;
  reason: string;
  moderator_comment: string | null;
  status: AppealStatus;
  created_at: number;
  updated_at: number;
  reviewed_by: string | null;
  reviewed_at: number | null;
};

export type AppealExistingRow = { id: number; number: number; status: AppealStatus };
export type AppealCounterRow = { appeal_counter: number };
export type WarnRow = { reason: string; created_at: number };
export type MusicSessionReadRow = Pick<MusicSessionRow, "guild_id" | "channel_id" | "message_id">;
export type EventNextSeriesRow = { id: string };
export type EventCountsRow = { joined: number; waitlist: number };
export type EventNextWaitlistedRow = { user_id: string };
export type ReminderDueRow = { id: number; event_id: string };
export type EventGuildCountRow = { eventId: string; joined: number; waitlist: number };
export type EventGuildParticipantRow = { eventId: string; userId: string; joinedAt: number; waitlist: number };

export type WelcomeSettingsRow = {
  guild_id: string;
  enabled: number;
  channel_id: string | null;
  message: string;
  image_enabled: number;
  updated_at: number;
  background_path: string | null;
  image_config_json: string;
  goodbye_enabled: number;
  goodbye_channel_id: string | null;
  goodbye_message: string;
};

export type GuildSecuritySettingsRow = {
  guild_id: string;
  ignored_role_ids_json: string;
  protected_channel_id: string | null;
  updated_at: number;
};

export type AutomodRuleSettingsRow = {
  id: number;
  guild_id: string;
  kind: string;
  enabled: number;
  action_json: string;
  threshold_json: string;
  window_seconds: number;
  escalation: number;
  updated_at: number;
};

export type LoggingSettingsRow = {
  guild_id: string;
  channel_id: string | null;
  categories_json: string;
  updated_at: number;
};

export type MusicSettingsRow = {
  guild_id: string;
  command_channel_id: string | null;
  voice_channel_ids_json: string;
  allowed_role_ids_json: string;
  leave_after_seconds: number;
  playlists_enabled: number;
  playlist_role_ids_json: string;
};

export type MessageCacheRow = {
  message_id: string;
  guild_id: string;
  channel_id: string;
  content: string;
  created_at: number;
};

export type GuildDailyMetricRow = {
  guild_id: string;
  day: string;
  joins: number;
  leaves: number;
  messages: number;
  moderation: number;
};

export type GuildDailyChannelStatRow = {
  guild_id: string;
  day: string;
  channel_id: string;
  messages: number;
};

export type GuildDailyUserStatRow = {
  guild_id: string;
  day: string;
  user_id: string;
  messages: number;
};

export type GuildHourlyMessageRow = {
  guild_id: string;
  day: string;
  hour: number;
  messages: number;
};
