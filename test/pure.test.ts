import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "goplay-pure-")), "test.sqlite");

// Тесты ядра плеера (pickAudioUrl и т.д.) живут в player.test.ts.
const { isMissingDiscordResource } = await import("../src/lib/errors.ts");
const { isSnowflake } = await import("../src/lib/guild-access.ts");
const { parseActions } = await import("../src/lib/json.ts");
const { automodDefaultActions } = await import("../src/lib/automod.ts");
const { extractFilenames, embedUploadPrefix } = await import("../src/lib/uploads.ts");
const { clampNumber } = await import("../src/lib/constants.ts");

// --- isMissingDiscordResource: единый предикат «ресурс удалён» --------------

test("isMissingDiscordResource различает коды и источники", () => {
  assert.equal(isMissingDiscordResource({ code: 10008 }), true);
  assert.equal(isMissingDiscordResource({ rawError: { code: 10003 } }), true);
  assert.equal(isMissingDiscordResource({ status: 404 }), true);
  // Транзиентные ошибки — не «удалён».
  assert.equal(isMissingDiscordResource({ code: 50013 }), false);
  assert.equal(isMissingDiscordResource({ status: 502 }), false);
  assert.equal(isMissingDiscordResource(new Error("network")), false);
  assert.equal(isMissingDiscordResource(null), false);
  // kind-ограничения: канал не должен детачиться от кода сообщения.
  assert.equal(isMissingDiscordResource({ code: 10008 }, "channel"), false);
  assert.equal(isMissingDiscordResource({ code: 10003 }, "channel"), true);
});

// --- isSnowflake / parseActions / extractFilenames ---------------------------
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

test("clampNumber: кламп, fallback и режимы округления/целочисленности", () => {
  assert.equal(clampNumber(150, 0, 0, 100), 100);
  assert.equal(clampNumber(-5, 0, 0, 100), 0);
  assert.equal(clampNumber("abc", 7, 0, 100), 7);
  assert.equal(clampNumber(undefined, 3, 0, 10), 3);
  assert.equal(clampNumber(4.6, 0, 0, 10, "round"), 5);
  assert.equal(clampNumber(4.6, 7, 0, 10, "integer"), 7);
  assert.equal(clampNumber(4, 7, 0, 10, "integer"), 4);
});
