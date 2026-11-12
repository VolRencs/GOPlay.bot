import { strict as assert } from "node:assert";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";

const { ttlCacheAsync } = await import("../src/lib/cache.ts");

test("ttlCacheAsync отдаёт stale-значение и не дёргает loader на каждом вызове", async () => {
  let calls = 0;
  let fail = false;
  const cache = ttlCacheAsync(async () => {
    calls += 1;
    if (fail) throw new Error("upstream down");
    return "value";
  }, 20, true);

  assert.equal(await cache.get("key"), "value");
  assert.equal(calls, 1);
  await sleep(30);
  fail = true;
  assert.equal(await cache.get("key"), "value");
  assert.equal(calls, 2);
  assert.equal(await cache.get("key"), "value");
  assert.equal(calls, 2, "stale-fallback продлевает TTL и не повторяет loader сразу");
});
