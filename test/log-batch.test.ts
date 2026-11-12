import { strict as assert } from "node:assert";
import { test } from "node:test";

const { takeLogBatch, isEmbedLimitError } = await import("../src/lib/log-batch.ts");

test("takeLogBatch укладывает embed'ы в лимит символов", () => {
  const queue = [{ length: 1000 }, { length: 2000 }, { length: 3000 }, { length: 4000 }];
  const batch = takeLogBatch(queue, 10, 4000);
  assert.deepEqual(batch.map(value => value.length), [1000, 2000]);
  assert.deepEqual(queue.map(value => value.length), [3000, 4000]);
});

test("takeLogBatch не превышает 10 embed'ов и продвигает очередь", () => {
  const queue = Array.from({ length: 15 }, () => ({ length: 1 }));
  assert.equal(takeLogBatch(queue, 10, 100).length, 10);
  assert.equal(queue.length, 5);
});

test("takeLogBatch отправляет одиночный слишком большой embed отдельно", () => {
  const queue = [{ length: 7000 }, { length: 10 }];
  assert.deepEqual(takeLogBatch(queue, 10, 5900).map(value => value.length), [7000]);
  assert.equal(queue.length, 1);
});

test("isEmbedLimitError распознаёт 50035", () => {
  assert.equal(isEmbedLimitError({ status: 400, code: 50035 }), true);
  assert.equal(isEmbedLimitError({ status: 400, code: 50013 }), false);
  assert.equal(isEmbedLimitError(new Error("400")), false);
  assert.equal(isEmbedLimitError(null), false);
});
