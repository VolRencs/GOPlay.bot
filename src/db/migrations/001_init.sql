CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);

CREATE TABLE guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, updated_at INTEGER NOT NULL, appeal_counter INTEGER NOT NULL DEFAULT 0, lang TEXT NOT NULL DEFAULT 'ru');

CREATE TABLE welcome_settings (guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE, enabled INTEGER NOT NULL DEFAULT 0, channel_id TEXT, message TEXT NOT NULL DEFAULT 'Welcome {user}!', image_enabled INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, background_path TEXT, image_config_json TEXT NOT NULL DEFAULT '{}', goodbye_enabled INTEGER NOT NULL DEFAULT 0, goodbye_channel_id TEXT, goodbye_message TEXT NOT NULL DEFAULT 'До встречи, {username}!');

CREATE TABLE automod_rules (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, kind TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, action_json TEXT NOT NULL DEFAULT '["delete","warn"]', threshold_json TEXT NOT NULL DEFAULT '{}', window_seconds INTEGER NOT NULL DEFAULT 10, escalation INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, UNIQUE(guild_id,kind));

CREATE TABLE self_role_panels (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, channel_id TEXT, message_id TEXT, title TEXT NOT NULL, style TEXT NOT NULL, updated_at INTEGER NOT NULL, role_limit INTEGER NOT NULL DEFAULT 0, role_mode TEXT NOT NULL DEFAULT 'toggle', notify_enabled INTEGER NOT NULL DEFAULT 1, notify_template TEXT NOT NULL DEFAULT '✅ Added **{role}**');

CREATE TABLE self_role_options (id INTEGER PRIMARY KEY, panel_id INTEGER NOT NULL REFERENCES self_role_panels(id) ON DELETE CASCADE, role_id TEXT NOT NULL, label TEXT NOT NULL, emoji TEXT, button_color TEXT NOT NULL DEFAULT 'primary', UNIQUE(panel_id,role_id));

CREATE TABLE embeds (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, name TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at INTEGER NOT NULL, channel_id TEXT, message_id TEXT, mode TEXT NOT NULL DEFAULT 'embed');

CREATE TABLE embed_sendings (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  embed_id INTEGER NOT NULL REFERENCES embeds(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);

CREATE TABLE moderation_actions (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, user_id TEXT NOT NULL, moderator_id TEXT, type TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL);

CREATE TABLE logging_settings (guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE, channel_id TEXT, categories_json TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL);

CREATE TABLE guild_security_settings (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  ignored_role_ids_json TEXT NOT NULL DEFAULT '[]',
  protected_channel_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE guild_daily_metrics (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  joins INTEGER NOT NULL DEFAULT 0,
  leaves INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  moderation INTEGER NOT NULL DEFAULT 0, active_users INTEGER NOT NULL DEFAULT 0, peak_messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, day)
);

CREATE TABLE guild_daily_channel_stats (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, day, channel_id)
);

CREATE TABLE guild_daily_user_stats (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  user_id TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, day, user_id)
);

CREATE TABLE guild_hourly_messages (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, day, hour)
);

CREATE TABLE dashboard_audit (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  section TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE message_cache (
  message_id TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE temp_channel_presets (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_channel_ids_json TEXT NOT NULL DEFAULT '[]',
  category_id TEXT,
  name_template TEXT NOT NULL DEFAULT '🔊 {username}''s room',
  user_limit INTEGER NOT NULL DEFAULT 0,
  can_rename INTEGER NOT NULL DEFAULT 1,
  can_manage_access INTEGER NOT NULL DEFAULT 1,
  can_close INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE temp_channels (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  panel_message_id TEXT,
  source_channel_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE music_settings (
  guild_id              TEXT PRIMARY KEY,
  command_channel_id    TEXT,                          -- канал, где разрешена /play; NULL — в любом
  voice_channel_ids_json TEXT NOT NULL DEFAULT '[]',   -- разрешённые голосовые каналы; '[]' — любые
  allowed_role_ids_json TEXT NOT NULL DEFAULT '[]',    -- роли, которым доступна /play; '[]' — только админы
  leave_after_seconds   INTEGER NOT NULL DEFAULT 300   -- автовыход после стольких секунд тишины
);

CREATE TABLE appeals (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  punishment_id INTEGER NOT NULL REFERENCES moderation_actions(id),
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  moderator_comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','approved','rejected','closed','declined')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  number INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE events (
  id                  TEXT PRIMARY KEY,
  guild_id            TEXT NOT NULL,
  channel_id          TEXT NOT NULL,
  message_id          TEXT,
  series_id           TEXT,
  embed_json          TEXT NOT NULL DEFAULT '{}',
  buttons_json        TEXT NOT NULL DEFAULT '[]',
  scheduled_at        INTEGER NOT NULL,
  max_participants    INTEGER NOT NULL DEFAULT 0,
  registration_enabled INTEGER NOT NULL DEFAULT 1,
  waitlist_enabled    INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'scheduled',
  event_role_id       TEXT,
  reminders_json      TEXT NOT NULL DEFAULT '[]',
  recurrence_json     TEXT NOT NULL DEFAULT '{}',
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  started_at          INTEGER,
  completed_at        INTEGER,
  cancelled_at        INTEGER,
  stats_json          TEXT
);

CREATE TABLE event_participants (
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  waitlist  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE event_reminders (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  due_at   INTEGER NOT NULL,
  sent_at  INTEGER,
  UNIQUE (event_id, due_at)
);

CREATE INDEX idx_panels_guild ON self_role_panels(guild_id);

CREATE INDEX idx_embeds_guild ON embeds(guild_id);

CREATE INDEX idx_actions_guild ON moderation_actions(guild_id,created_at DESC);

CREATE INDEX idx_embed_sendings_guild ON embed_sendings(guild_id, embed_id, sent_at DESC);

CREATE INDEX idx_temp_presets_guild ON temp_channel_presets(guild_id);

CREATE INDEX idx_dashboard_audit_guild ON dashboard_audit(guild_id, created_at DESC);

CREATE INDEX idx_actions_user ON moderation_actions(guild_id, user_id, created_at DESC);

CREATE INDEX idx_appeals_guild ON appeals(guild_id, created_at DESC);

CREATE INDEX idx_appeals_user ON appeals(guild_id, user_id, created_at DESC);

CREATE INDEX idx_embeds_message ON embeds(guild_id, channel_id, message_id);

CREATE UNIQUE INDEX idx_appeals_number ON appeals(guild_id, number);

CREATE INDEX idx_message_cache_guild_created ON message_cache (guild_id, created_at);

CREATE INDEX idx_events_guild ON events (guild_id);

CREATE INDEX idx_events_series ON events (series_id);

CREATE INDEX idx_event_participants_waitlist ON event_participants (event_id, waitlist, joined_at);

CREATE INDEX idx_event_reminders_due ON event_reminders (due_at, sent_at);

CREATE UNIQUE INDEX idx_temp_channels_guild_owner ON temp_channels(guild_id, owner_id);

CREATE INDEX idx_events_scheduled ON events(scheduled_at) WHERE status = 'scheduled';

CREATE UNIQUE INDEX idx_appeals_punishment_unique ON appeals(punishment_id);

CREATE INDEX idx_events_message ON events(message_id) WHERE message_id IS NOT NULL;

CREATE INDEX idx_daily_metrics_day ON guild_daily_metrics(day);

CREATE INDEX idx_channel_stats_day ON guild_daily_channel_stats(day);

CREATE INDEX idx_user_stats_day ON guild_daily_user_stats(day);

CREATE INDEX idx_hourly_day ON guild_hourly_messages(day);
