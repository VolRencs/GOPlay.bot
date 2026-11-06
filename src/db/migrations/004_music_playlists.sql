ALTER TABLE music_settings ADD COLUMN playlists_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE music_settings ADD COLUMN playlist_role_ids_json TEXT NOT NULL DEFAULT '[]';
