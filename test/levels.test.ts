import { strict as assert } from "node:assert";
import { test } from "node:test";
import { useTempDb } from "./helpers.ts";

useTempDb("goplay-levels-");

const { xpForLevel, levelFromXp, levelProgress, levelDefaults, MAX_LEVEL } = await import("../src/lib/levels.ts");
const { levelSettingsFor } = await import("../src/lib/levels-store.ts");
const { db } = await import("../src/db/database.ts");
const { stmt } = await import("../src/db/statements.ts");

test("формула уровней: порог и обратный уровень согласованы", () => {
  assert.equal(xpForLevel(0, 100, 15), 0);
  assert.equal(xpForLevel(1, 100, 15), 100);
  assert.equal(xpForLevel(2, 100, 15), 100 + 115);
  assert.equal(levelFromXp(0, 100, 15), 0);
  assert.equal(levelFromXp(99, 100, 15), 0);
  assert.equal(levelFromXp(100, 100, 15), 1);
  assert.equal(levelFromXp(214, 100, 15), 1);
  assert.equal(levelFromXp(215, 100, 15), 2);
});

test("рост 0% даёт фиксированный порог уровня", () => {
  assert.equal(xpForLevel(3, 50, 0), 150);
  assert.equal(levelFromXp(149, 50, 0), 2);
  assert.equal(levelFromXp(150, 50, 0), 3);
});

test("levelProgress отдаёт прогресс внутри уровня и кап", () => {
  assert.deepEqual(levelProgress(0, 100, 0), { level: 0, current: 0, needed: 100 });
  assert.deepEqual(levelProgress(150, 100, 0), { level: 1, current: 50, needed: 100 });
  assert.deepEqual(levelProgress(9_999_999, 10, 1), { level: MAX_LEVEL, current: 0, needed: 0 });
});

test("настройки читаются с дефолтами, клампами и нормализацией режима", () => {
  db.prepare("INSERT INTO guilds(id,name,icon,updated_at) VALUES('g1','G',NULL,?)").run(Date.now());
  assert.deepEqual(levelSettingsFor("g1"), { ...levelDefaults, ignored_channel_ids: [], ignored_role_ids: [] });
  stmt.levelSettingsUpsert.run({
    guild_id: "g1", enabled: 1, xp_per_message: 20, message_cooldown_seconds: 30,
    min_message_length: 5, xp_per_voice_minute: 2, base_xp: 200, growth_percent: 10,
    ignored_channel_ids_json: JSON.stringify(["123456789012345"]), ignored_role_ids_json: JSON.stringify([]),
    notify_mode: "dm", notify_channel_id: null, updated_at: Date.now(),
  });
  const saved = levelSettingsFor("g1");
  assert.equal(saved.enabled, true);
  assert.equal(saved.xp_per_message, 20);
  assert.equal(saved.notify_mode, "dm");
  assert.deepEqual(saved.ignored_channel_ids, ["123456789012345"]);
  db.prepare("INSERT INTO guilds(id,name,icon,updated_at) VALUES('g2','G',NULL,?)").run(Date.now());
  stmt.levelSettingsUpsert.run({
    guild_id: "g2", enabled: 1, xp_per_message: 5000, message_cooldown_seconds: 30,
    min_message_length: 0, xp_per_voice_minute: 0, base_xp: 0, growth_percent: 0,
    ignored_channel_ids_json: "[]", ignored_role_ids_json: "[]",
    notify_mode: "bogus", notify_channel_id: null, updated_at: Date.now(),
  });
  const clamped = levelSettingsFor("g2");
  assert.equal(clamped.xp_per_message, 100);
  assert.equal(clamped.base_xp, 10);
  assert.equal(clamped.notify_mode, "channel");
});

test("XP инкрементится, место в топе и лидерборд считаются", () => {
  stmt.levelUpsert.run({ guild_id: "g1", user_id: "u1", xp: 50, level: 0, messages: 3, voice_seconds: 60, updated_at: Date.now() });
  stmt.levelUpsert.run({ guild_id: "g1", user_id: "u1", xp: 60, level: 1, messages: 1, voice_seconds: 0, updated_at: Date.now() });
  const row = stmt.levelRow.get("g1", "u1");
  assert.deepEqual({ ...row }, { xp: 110, level: 1, messages: 4, voice_seconds: 60 });
  stmt.levelUpsert.run({ guild_id: "g1", user_id: "u2", xp: 500, level: 2, messages: 9, voice_seconds: 0, updated_at: Date.now() });
  assert.equal(stmt.levelRank.get("g1", 110)!.rank, 2);
  assert.equal(stmt.levelRank.get("g1", 500)!.rank, 1);
  const top = stmt.levelTop.all("g1", 10);
  assert.equal(top[0]?.user_id, "u2");
});

test("уровень хранится как максимум: рост порогов не понижает его", () => {
  db.prepare("INSERT INTO guilds(id,name,icon,updated_at) VALUES('g3','G',NULL,?)").run(Date.now());
  stmt.levelUpsert.run({ guild_id: "g3", user_id: "u1", xp: 500, level: 5, messages: 0, voice_seconds: 0, updated_at: Date.now() });
  stmt.levelUpsert.run({ guild_id: "g3", user_id: "u1", xp: 10, level: 2, messages: 1, voice_seconds: 0, updated_at: Date.now() });
  const row = stmt.levelRow.get("g3", "u1")!;
  assert.equal(row.level, 5);
  assert.equal(row.xp, 510);
});

test("XP удалённой гильдии выбрасывается из буфера, а не зацикливает флаш", async () => {
  const { EventEmitter } = await import("node:events");
  const { registerLevels, flushLevels } = await import("../src/bot/levels/index.ts");
  const emitter = new EventEmitter();
  registerLevels(emitter as never);
  const guildId = "g9";
  db.prepare("INSERT INTO guilds(id,name,icon,updated_at) VALUES(?,?,NULL,?)").run(guildId, "G", Date.now());
  stmt.levelSettingsUpsert.run({
    guild_id: guildId, enabled: 1, xp_per_message: 10, message_cooldown_seconds: 60,
    min_message_length: 0, xp_per_voice_minute: 5, base_xp: 100, growth_percent: 15,
    ignored_channel_ids_json: "[]", ignored_role_ids_json: "[]",
    notify_mode: "off", notify_channel_id: null, updated_at: Date.now(),
  });
  emitter.emit("messageCreate", {
    guild: { id: guildId },
    author: { id: "u1", bot: false },
    channelId: "c1",
    content: "hello world",
    member: { roles: { cache: { some: () => false } } },
  });
  db.prepare("DELETE FROM guilds WHERE id=?").run(guildId);
  flushLevels();
  // Если запись не выброшена, после воссоздания гильдии повторный флаш её запишет.
  db.prepare("INSERT INTO guilds(id,name,icon,updated_at) VALUES(?,?,NULL,?)").run(guildId, "G", Date.now());
  flushLevels();
  assert.equal(stmt.levelRow.get(guildId, "u1"), undefined);
});
