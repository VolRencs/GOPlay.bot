import test from "node:test";
import assert from "node:assert/strict";
import { seedGuilds, useTempDb } from "./helpers.ts";

useTempDb("goplay-settings-views-");
await seedGuilds(["g1"]);
const { stmt } = await import("../src/db/statements.ts");
const { describeChanges } = await import("../src/lib/dashboard-audit.ts");
const {
  autoroleState, autoroleView, levelsState, levelsView, loggingState, loggingView,
  musicState, musicView, welcomeState, welcomeView,
} = await import("../src/lib/settings-views.ts");

test("welcome state defaults and diff", () => {
  const { state, exists } = welcomeState("g1");
  assert.equal(exists, false);
  assert.equal(state.message, "Добро пожаловать, {user}!");
  assert.equal(describeChanges(welcomeView(state), welcomeView({ ...state, message: "Hi" })), "Текст приветствия: Добро пожаловать, {user}! → Hi");
});

test("background upload keeps code defaults for a new welcome row", async () => {
  const { welcomeQueries } = await import("../src/db/queries.ts");
  const { fromDto, welcomeDefaults } = await import("../src/contracts/welcome.ts");
  welcomeQueries.backgroundUpsert.run({
    ...fromDto(welcomeDefaults),
    guild_id: "g1",
    background_path: "/uploads/welcome/g1-welcome.png",
    updated_at: Date.now(),
  });
  const { state, exists } = welcomeState("g1");
  assert.equal(exists, true);
  assert.equal(state.message, welcomeDefaults.message);
  assert.equal(state.goodbyeMessage, welcomeDefaults.goodbyeMessage);

  // Повторная загрузка фона обновляет только путь, не настройки.
  welcomeQueries.upsert.run({ ...fromDto({ ...state, message: "Custom" }), guild_id: "g1", updated_at: Date.now() });
  welcomeQueries.backgroundUpsert.run({
    ...fromDto(welcomeDefaults),
    guild_id: "g1",
    background_path: "/uploads/welcome/g1-welcome.jpg",
    updated_at: Date.now(),
  });
  assert.equal(welcomeState("g1").state.message, "Custom");
});

test("logging state merges defaults and diff", () => {
  const { state, exists } = loggingState("g1");
  assert.equal(exists, false);
  assert.equal(state.categories.member_join, true);
  assert.equal(describeChanges(loggingView(state), loggingView({ ...state, channelId: "123456789012345" })), "Канал: — → <#123456789012345>");
});

test("music state defaults and diff", () => {
  const { state, exists } = musicState("g1");
  assert.equal(exists, false);
  assert.equal(state.playlistsEnabled, true);
  assert.equal(describeChanges(musicView(state), musicView({ ...state, leaveAfterSeconds: 60 })), "Автовыход: 5 мин → 1 мин");
});

test("levels state defaults and diff", () => {
  const { state, exists } = levelsState("g1");
  assert.equal(exists, false);
  assert.equal(state.settings.xpPerMessage, 10);
  assert.equal(describeChanges(levelsView(state), levelsView({ ...state, settings: { ...state.settings, enabled: true } })), "Система уровней: выкл → вкл");
});

test("autorole state defaults and diff", () => {
  const { state, exists } = autoroleState("g1");
  assert.equal(exists, false);
  assert.equal(state.enabled, false);
  assert.equal(describeChanges(autoroleView(state), autoroleView({ ...state, enabled: true })), "Включено: выкл → вкл");
});

test("upsert helper increments metrics instead of replacing them", async () => {
  stmt.metric.run({ guild_id: "g1", day: "2026-01-01", joins: 1, leaves: 0, messages: 2, moderation: 0 });
  stmt.metric.run({ guild_id: "g1", day: "2026-01-01", joins: 2, leaves: 1, messages: 3, moderation: 4 });
  const { db } = await import("../src/db/database.ts");
  const row = db.prepare("SELECT joins,leaves,messages,moderation FROM guild_daily_metrics WHERE guild_id=? AND day=?").get("g1", "2026-01-01") as { joins: number; leaves: number; messages: number; moderation: number };
  assert.deepEqual({ ...row }, { joins: 3, leaves: 1, messages: 5, moderation: 4 });
});
