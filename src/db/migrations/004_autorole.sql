CREATE TABLE autorole_settings (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  role_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);