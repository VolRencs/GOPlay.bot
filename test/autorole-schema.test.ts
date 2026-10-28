import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { useTempDb } from "./helpers.ts";

const dbPath = useTempDb("goplay-autorole-schema-");
// База «промежуточной» версии: автороль хранила массив ролей в role_ids_json.
const legacy = new DatabaseSync(dbPath);
legacy.exec("CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
legacy.prepare("INSERT INTO _migrations VALUES (?,?)").run("001_init.sql", 1);
legacy.exec("CREATE TABLE guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, updated_at INTEGER NOT NULL)");
// 004_music_playlists.sql мигрирует эту таблицу; в реальной БД 001 уже её создала.
legacy.exec("CREATE TABLE music_settings (guild_id TEXT PRIMARY KEY, command_channel_id TEXT, voice_channel_ids_json TEXT NOT NULL DEFAULT '[]', allowed_role_ids_json TEXT NOT NULL DEFAULT '[]', leave_after_seconds INTEGER NOT NULL DEFAULT 300)");
legacy.exec("CREATE TABLE autorole_settings (guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE, enabled INTEGER NOT NULL DEFAULT 0, role_ids_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL)");
legacy.prepare("INSERT INTO guilds VALUES (?,?,?,?)").run("g1", "Тест", null, 1);
legacy.prepare("INSERT INTO autorole_settings VALUES (?,?,?,?)").run("g1", 1, '["123456789012345678"]', 1);
legacy.close();

const { db } = await import("../src/db/database.ts");

test("старая схема автороли приводится к одной роли", () => {
  const columns = (db.prepare("PRAGMA table_info(autorole_settings)").all() as { name: string }[]).map(column => column.name);
  assert.ok(columns.includes("role_id"), "должна появиться колонка role_id");
  const row = db.prepare("SELECT enabled, role_id FROM autorole_settings WHERE guild_id=?").get("g1") as { enabled: number; role_id: string | null };
  assert.equal(row.enabled, 1);
  assert.equal(row.role_id, "123456789012345678");
});
