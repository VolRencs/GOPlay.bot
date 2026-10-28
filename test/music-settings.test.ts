import test from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./helpers.ts";

useTempDb("goplay-music-settings-");

const { db } = await import("../src/db/database.ts");
const { musicSettingsFor } = await import("../src/lib/music-settings.ts");

test("music settings: playlists по умолчанию включены и роли пусты", () => {
  const settings = musicSettingsFor("g-default");
  assert.equal(settings.playlists_enabled, true);
  assert.deepEqual(settings.playlist_role_ids, []);
});

test("music settings: ограничения плейлистов читаются из строки", () => {
  db.prepare("INSERT INTO music_settings(guild_id, playlists_enabled, playlist_role_ids_json) VALUES(?,?,?)")
    .run("g-restricted", 0, '["123456789012345678","987654321098765432"]');
  const settings = musicSettingsFor("g-restricted");
  assert.equal(settings.playlists_enabled, false);
  assert.deepEqual(settings.playlist_role_ids, ["123456789012345678", "987654321098765432"]);
});
