import test from "node:test"; import assert from "node:assert/strict";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { mkdtempSync } from "node:fs";

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "goplay-test-")), "bot.sqlite");
const { addMessage, flushMetrics } = await import("../src/bot/metrics.ts");
const { db } = await import("../src/db/database.ts");
const { renderName, getConfig } = await import("../src/bot/tempchannels/index.ts");
const { parseStringArray: parseTriggers } = await import("../src/lib/json.ts");
const { DEFAULT_SETTINGS } = await import("../src/lib/tempchannels.ts");

for (const guildId of ["g1", "g2", "g3"]) db.prepare("INSERT OR IGNORE INTO guilds(id,name,icon,updated_at) VALUES(?,?,?,?)").run(guildId, guildId, null, Date.now());

const plain = <T extends object>(rows: T[]): T[] => rows.map(row => ({ ...row }));
const at = (day: string, hour: number, minute = 0) => new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`).getTime();

test("messages, channels and users are aggregated without double counting", () => {
  const day = "2026-08-17";
  addMessage("g1", "c1", "u1", at(day, 10));
  addMessage("g1", "c1", "u1", at(day, 10));
  addMessage("g1", "c2", "u2", at(day, 11));
  flushMetrics();
  const daily = db.prepare("SELECT * FROM guild_daily_metrics WHERE guild_id='g1'").get() as { day: string; messages: number; active_users: number; peak_messages: number };
  assert.equal(daily.day, day); assert.equal(daily.messages, 3); assert.equal(daily.active_users, 2); assert.equal(daily.peak_messages, 2);
  const channels = plain(db.prepare("SELECT channel_id,messages FROM guild_daily_channel_stats WHERE guild_id='g1' ORDER BY channel_id").all() as { channel_id: string; messages: number }[]);
  assert.deepEqual(channels, [{ channel_id: "c1", messages: 2 }, { channel_id: "c2", messages: 1 }]);
  const users = plain(db.prepare("SELECT user_id,messages FROM guild_daily_user_stats WHERE guild_id='g1' ORDER BY user_id").all() as { user_id: string; messages: number }[]);
  assert.deepEqual(users, [{ user_id: "u1", messages: 2 }, { user_id: "u2", messages: 1 }]);
  const hourly = plain(db.prepare("SELECT hour,messages FROM guild_hourly_messages WHERE guild_id='g1' ORDER BY hour").all() as { hour: number; messages: number }[]);
  assert.deepEqual(hourly, [{ hour: 10, messages: 2 }, { hour: 11, messages: 1 }]);
});

test("a user is counted once per day even across repeated flushes", () => {
  const day = "2026-08-16";
  addMessage("g1", "c1", "u1", at(day, 9));
  flushMetrics();
  addMessage("g1", "c1", "u1", at(day, 12));
  flushMetrics();
  const daily = db.prepare("SELECT active_users FROM guild_daily_metrics WHERE guild_id='g1' AND day=?").get(day) as { active_users: number };
  assert.equal(daily.active_users, 1);
});

test("a new day counts the same user again", () => {
  addMessage("g2", "c1", "u1", at("2026-08-01", 9));
  addMessage("g2", "c1", "u1", at("2026-08-02", 9));
  flushMetrics();
  const rows = plain(db.prepare("SELECT day,active_users FROM guild_daily_metrics WHERE guild_id='g2' ORDER BY day").all() as { day: string; active_users: number }[]);
  assert.deepEqual(rows, [{ day: "2026-08-01", active_users: 1 }, { day: "2026-08-02", active_users: 1 }]);
});

test("peak tracks the busiest single hour", () => {
  addMessage("g3", "c1", "u1", at("2026-08-10", 14));
  addMessage("g3", "c1", "u1", at("2026-08-10", 14));
  addMessage("g3", "c1", "u1", at("2026-08-10", 15));
  flushMetrics();
  const daily = db.prepare("SELECT peak_messages FROM guild_daily_metrics WHERE guild_id='g3'").get() as { peak_messages: number };
  assert.equal(daily.peak_messages, 2);
});

test("a deleted guild is evicted without blocking live metrics", () => {
  const day = "2026-07-15";
  db.prepare("INSERT OR IGNORE INTO guilds(id,name,icon,updated_at) VALUES(?,?,?,?)").run("g9", "g9", null, Date.now());
  addMessage("g1", "c1", "u1", at(day, 8));
  addMessage("g9", "c1", "u1", at(day, 8));
  db.prepare("DELETE FROM guilds WHERE id='g9'").run();
  flushMetrics();
  const live = db.prepare("SELECT messages FROM guild_daily_metrics WHERE guild_id='g1' AND day=?").get(day) as { messages: number } | undefined;
  assert.equal(live?.messages, 1);
  const dead = db.prepare("SELECT COUNT(*) AS n FROM guild_daily_metrics WHERE guild_id='g9'").get() as { n: number };
  assert.equal(dead.n, 0);
});

test("temp trigger parsing and name template rendering", () => {
  assert.deepEqual(parseTriggers('["a","b"]'), ["a", "b"]);
  assert.deepEqual(parseTriggers("garbage"), []);
  const member = { user: { username: "alice" }, displayName: "Alice" };
  assert.equal(renderName("🔊 {username}'s room", member), "🔊 alice's room");
  assert.equal(renderName("{displayName}", member), "Alice");
  assert.equal(renderName("{user}", member), "alice");
  assert.equal(renderName("x".repeat(200), member).length, 100);
});

test("temp config resolution: each preset configures its own trigger channels", () => {
  const guild = "g4";
  db.prepare("INSERT OR IGNORE INTO guilds(id,name,icon,updated_at) VALUES(?,?,?,?)").run(guild, guild, null, Date.now());
  db.prepare("INSERT INTO temp_channel_presets(guild_id,name,trigger_channel_ids_json,category_id,name_template,user_limit,can_rename,can_manage_access,can_close,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(guild, "Main", '["111"]', "cat1", "Room {username}", 5, 1, 0, 1, Date.now());
  db.prepare("INSERT INTO temp_channel_presets(guild_id,name,trigger_channel_ids_json,category_id,name_template,user_limit,can_rename,can_manage_access,can_close,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(guild, "Private", '["222"]', "cat2", "{username} private", 2, 0, 1, 1, Date.now());
  const main = getConfig(guild, "111");
  assert.equal(main.category_id, "cat1");
  assert.equal(main.name_template, "Room {username}");
  assert.equal(main.user_limit, 5);
  assert.equal(main.can_manage_access, 0);
  const custom = getConfig(guild, "222");
  assert.equal(custom.category_id, "cat2");
  assert.equal(custom.name_template, "{username} private");
  assert.equal(custom.user_limit, 2);
  assert.equal(custom.can_rename, 0);
  assert.equal(custom.can_manage_access, 1);
  assert.deepEqual(getConfig(guild, "333"), DEFAULT_SETTINGS);
  assert.deepEqual(getConfig(guild, null), DEFAULT_SETTINGS);
});