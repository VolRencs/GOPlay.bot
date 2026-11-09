import { strict as assert } from "node:assert";
import { test } from "node:test";
import { useTempDb } from "./helpers.ts";

useTempDb("goplay-pure-");

const { isMissingDiscordResource } = await import("../src/lib/errors.ts");
const { isSnowflake } = await import("../src/lib/ids.ts");
const { parseActions } = await import("../src/lib/json.ts");
const { automodDefaultActions } = await import("../src/lib/automod.ts");
const { extractFilenames, embedUploadPrefix } = await import("../src/lib/uploads.ts");
const { clampNumber } = await import("../src/lib/constants.ts");
const { db } = await import("../src/db/database.ts");

test("isMissingDiscordResource различает коды и источники", () => {
  assert.equal(isMissingDiscordResource({ code: 10008 }), true);
  assert.equal(isMissingDiscordResource({ rawError: { code: 10003 } }), true);
  assert.equal(isMissingDiscordResource({ status: 404 }), true);
  assert.equal(isMissingDiscordResource({ code: 50013 }), false);
  assert.equal(isMissingDiscordResource({ status: 502 }), false);
  assert.equal(isMissingDiscordResource(new Error("network")), false);
  assert.equal(isMissingDiscordResource(null), false);
  assert.equal(isMissingDiscordResource({ code: 10008 }, "channel"), false);
  assert.equal(isMissingDiscordResource({ code: 10003 }, "channel"), true);
});

test("isSnowflake держит границы длины", () => {
  for (const bad of ["", "1234567890123", "123456789012345678901234", "12abc", ".."]) assert.equal(isSnowflake(bad), false, bad);
  assert.equal(isSnowflake("123456789012345"), true);
  assert.equal(isSnowflake("1234567890123456789012"), true);
});

test("parseActions возвращает общий дефолт для пустых данных", () => {
  assert.deepEqual(parseActions(null), [...automodDefaultActions]);
  assert.deepEqual(parseActions(""), [...automodDefaultActions]);
  assert.deepEqual(parseActions("[]"), [...automodDefaultActions]);
  assert.deepEqual(parseActions('["timeout"]'), ["timeout"]);
});

test("extractFilenames не выпускает пути за пределы каталога гильдии", () => {
  const prefix = embedUploadPrefix("123");
  assert.deepEqual(extractFilenames(prefix, [`${prefix}pic.png`, `${prefix}../secret.png`, "/etc/passwd", `${prefix}a/b.png`, null]), ["pic.png"]);
});

test("i18n: у каждой строки словарей есть непустые ru и en", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const dir = new URL("../src/lib/i18n/", import.meta.url);
  const files = ["bot.ts", ...(await readdir(new URL("bot/", dir))).filter(f => f.endsWith(".ts")).map(f => `bot/${f}`)];
  const entryRe = /^\s{2}(\w+):\s*\{/gm;
  const fullRe = /(\w+):\s*\{\s*ru:\s*"((?:[^"\\]|\\.)*)"\s*,\s*en:\s*"((?:[^"\\]|\\.)*)"\s*\}/gs;
  for (const file of files) {
    const src = await readFile(new URL(file, dir), "utf8");
    const complete = new Set([...src.matchAll(fullRe)].map(m => m[1]));
    for (const [, key] of src.matchAll(entryRe)) {
      assert.ok(key !== undefined && complete.has(key), `${file}: ключ ${key} без пары ru/en`);
    }
  }
});

test("schema: создаёт прикладные таблицы и не содержит устаревших колонок", () => {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name));
  for (const name of ["guilds", "welcome_settings", "automod_rules", "embeds", "message_cache", "music_sessions", "level_settings", "member_levels", "level_rewards", "events", "appeals"]) {
    assert.ok(tables.has(name), name);
  }
  const columns = (table: string) => (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(row => row.name);
  assert.ok(!columns("guilds").includes("icon"));
  assert.ok(!columns("guilds").includes("updated_at"));
  assert.ok(!columns("message_cache").includes("channel_id"));
  assert.ok(!columns("music_sessions").includes("updated_at"));
  const migrations = (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map(row => row.name);
  assert.deepEqual(migrations, ["001_init.sql", "002_hourly_member_metrics.sql"]);
  assert.deepEqual(columns("guild_hourly_messages"), ["guild_id", "day", "hour", "messages", "joins", "leaves"]);
});

test("clampNumber: кламп, fallback и режимы округления/целочисленности", () => {
  assert.equal(clampNumber(150, 0, 0, 100), 100);
  assert.equal(clampNumber(-5, 0, 0, 100), 0);
  assert.equal(clampNumber("abc", 7, 0, 100), 7);
  assert.equal(clampNumber(undefined, 3, 0, 10), 3);
  assert.equal(clampNumber(null, 3, 0, 10), 3);
  assert.equal(clampNumber("", 3, 0, 10), 3);
  assert.equal(clampNumber(4.6, 0, 0, 10, "round"), 5);
  assert.equal(clampNumber(4.6, 7, 0, 10, "integer"), 7);
  assert.equal(clampNumber(4, 7, 0, 10, "integer"), 4);
});
