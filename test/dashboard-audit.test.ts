import test from "node:test"; import assert from "node:assert/strict";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { mkdtempSync } from "node:fs";

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "goplay-audit-test-")), "bot.sqlite");
const { describeChanges } = await import("../src/lib/dashboard-audit.ts");

test("describeChanges: только изменённые скаляры в формате было → стало", () => {
  assert.equal(
    describeChanges({ "Канал": null, "XP": 10, "Режим": true }, { "Канал": "<#1>", "XP": 10, "Режим": false }),
    "Канал: — → <#1> · Режим: вкл → выкл",
  );
});

test("describeChanges: массивы — добавлено и убрано", () => {
  assert.equal(
    describeChanges({ "Роли": ["<@&1>", "<@&2>"] }, { "Роли": ["<@&2>", "<@&3>"] }),
    "Роли: добавлено <@&3>; убрано <@&1>",
  );
});

test("describeChanges: без изменений — пустая строка", () => {
  assert.equal(describeChanges({ "A": 1, "B": ["x"] }, { "A": 1, "B": ["x"] }), "");
});

test("describeChanges: opaque-поля и обрезка длинных значений", () => {
  assert.equal(describeChanges({ "Конфиг": "a" }, { "Конфиг": "b" }, { "Конфиг": "изменён" }), "Конфиг: изменён");
  assert.equal(describeChanges({ "Текст": "коротко" }, { "Текст": "я".repeat(200) }), `Текст: коротко → ${"я".repeat(77)}…`);
});

test("describeChanges: итог ограничен 480 символами", () => {
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  for (let index = 0; index < 60; index++) { before[`Поле ${index}`] = "a"; after[`Поле ${index}`] = "b"; }
  const summary = describeChanges(before, after);
  assert.ok(summary.length <= 480);
  assert.ok(summary.endsWith("…"));
});
