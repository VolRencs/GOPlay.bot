CREATE TABLE IF NOT EXISTS music_sessions (
  guild_id   TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
