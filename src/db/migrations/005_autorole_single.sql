CREATE TABLE autorole_settings_new (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  role_id TEXT,
  updated_at INTEGER NOT NULL
);

INSERT INTO autorole_settings_new (guild_id, enabled, role_id, updated_at)
SELECT guild_id, enabled, json_extract(role_ids_json, '$[0]'), updated_at
FROM autorole_settings;

DROP TABLE autorole_settings;
ALTER TABLE autorole_settings_new RENAME TO autorole_settings;
