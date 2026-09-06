import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dbPath = join(mkdtempSync(join(tmpdir(), "goplay-message-cache-")), "bot.sqlite");
process.env.DATABASE_PATH = dbPath;
const { db } = await import("../src/db/database.ts");
const { rememberMessage, messageContent, forgetMessage, flushMessageCache, enforceMessageCap, MESSAGE_CACHE_PER_GUILD } = await import("../src/bot/db/message-cache.ts");

const plain = <T extends object>(value: T | undefined): T | undefined => value ? { ...value } : undefined;
const row = (messageId: string) => plain(db.prepare("SELECT guild_id,channel_id,content,created_at FROM message_cache WHERE message_id=?").get(messageId) as { guild_id: string; channel_id: string; content: string; created_at: number } | undefined);
const countFor = (guildId: string) => (db.prepare("SELECT COUNT(*) AS count FROM message_cache WHERE guild_id=?").get(guildId) as { count: number }).count;

test("create stores the message and its metadata", () => {
  rememberMessage("m1", "g1", "c1", "привет мир", 1_000);
  flushMessageCache();
  assert.equal(messageContent("m1"), "привет мир");
  assert.deepEqual(row("m1"), { guild_id: "g1", channel_id: "c1", content: "привет мир", created_at: 1_000 });
});

test("update overwrites the content but keeps the original created_at", () => {
  rememberMessage("m1", "g1", "c1", "изменено", 9_000);
  assert.equal(messageContent("m1"), "изменено");
  assert.equal(row("m1")?.created_at, 1_000);
});

test("delete returns the content and removes the row", () => {
  assert.equal(forgetMessage("m1"), "изменено");
  assert.equal(messageContent("m1"), null);
  assert.equal(row("m1"), undefined);
});

test("missing messages yield null", () => {
  assert.equal(messageContent("never-seen"), null);
  assert.equal(forgetMessage("never-seen"), null);
});

test("data survives a restart (a second connection reads the same rows)", () => {
  rememberMessage("m2", "g2", "c2", "до перезапуска", 5_000);
  flushMessageCache();
  const restarted = new DatabaseSync(dbPath);
  const seen = plain(restarted.prepare("SELECT content,created_at FROM message_cache WHERE message_id='m2'").get() as { content: string; created_at: number } | undefined);
  assert.deepEqual(seen, { content: "до перезапуска", created_at: 5_000 });
  restarted.close();
});

test("per-guild limit: only the newest 1000 rows are kept", () => {
  // Prune троттлится (раз в 30 c на гильдию), поэтому после серии вставок
  // вызываем обрезку явно — как это делает следующий тик rememberMessage.
  for (let i = 0; i < MESSAGE_CACHE_PER_GUILD + 5; i++) rememberMessage(`g3-${i}`, "g3", "c3", `text ${i}`, i);
  flushMessageCache();
  enforceMessageCap("g3");
  assert.equal(countFor("g3"), MESSAGE_CACHE_PER_GUILD);
  assert.equal(messageContent("g3-0"), null);
  assert.equal(messageContent("g3-4"), null);
  assert.equal(messageContent(`g3-${MESSAGE_CACHE_PER_GUILD + 4}`), `text ${MESSAGE_CACHE_PER_GUILD + 4}`);
});

test("other guilds are unaffected by a guild hitting the limit", () => {
  rememberMessage("g2-keep", "g2", "c2", "не тронуто", 6_000);
  assert.equal(messageContent("g2-keep"), "не тронуто");
  flushMessageCache();
  assert.equal(countFor("g2"), 2);
});