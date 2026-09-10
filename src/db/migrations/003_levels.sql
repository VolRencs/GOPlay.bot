-- Система уровней: настройки гильдии, накопленный XP участников и роли-награды.
-- XP копится инкрементом (бот буферизует его в памяти), а level хранится как
-- производная от xp для быстрых топов и выдачи ролей.
CREATE TABLE IF NOT EXISTS level_settings (
  guild_id                 TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  enabled                  INTEGER NOT NULL DEFAULT 0,
  xp_per_message           INTEGER NOT NULL DEFAULT 10,
  message_cooldown_seconds INTEGER NOT NULL DEFAULT 60,
  min_message_length       INTEGER NOT NULL DEFAULT 0,
  xp_per_voice_minute      INTEGER NOT NULL DEFAULT 5,
  base_xp                  INTEGER NOT NULL DEFAULT 100,
  growth_percent           INTEGER NOT NULL DEFAULT 15,
  ignored_channel_ids_json TEXT NOT NULL DEFAULT '[]',
  ignored_role_ids_json    TEXT NOT NULL DEFAULT '[]',
  notify_mode              TEXT NOT NULL DEFAULT 'channel',
  notify_channel_id        TEXT,
  updated_at               INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS member_levels (
  guild_id      TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  xp            INTEGER NOT NULL DEFAULT 0,
  level         INTEGER NOT NULL DEFAULT 0,
  messages      INTEGER NOT NULL DEFAULT 0,
  voice_seconds INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- Топ и место в рейтинге: COUNT(*) с xp>? без индекса сканировал бы гильдию.
CREATE INDEX IF NOT EXISTS idx_member_levels_rank ON member_levels(guild_id, xp DESC);

CREATE TABLE IF NOT EXISTS level_rewards (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  level    INTEGER NOT NULL,
  role_id  TEXT NOT NULL,
  PRIMARY KEY (guild_id, level)
);
