import { strict as assert } from "node:assert";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";

const { ttlCacheAsync, createLimiter, createKeyedLock } = await import("../src/lib/cache.ts");

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

test("createLimiter держит лимит параллельных задач", async () => {
  const withSlot = createLimiter(2);
  let active = 0, peak = 0;
  const task = () => withSlot(async () => {
    active++;
    peak = Math.max(peak, active);
    await sleep(10);
    active--;
  });
  await Promise.all([task(), task(), task(), task()]);
  assert.equal(peak, 2);
  assert.equal(active, 0);
});

test("createKeyedLock сериализует только одинаковые ключи", async () => {
  const withLock = createKeyedLock();
  const events: string[] = [];
  const first = withLock("a", async () => { events.push("a1"); await sleep(10); events.push("a2"); });
  const second = withLock("a", async () => { events.push("a3"); });
  const other = withLock("b", async () => { events.push("b1"); });
  await Promise.all([first, second, other]);
  assert.ok(events.indexOf("a2") < events.indexOf("a3"), "второй захват ключа ждёт первый");
  assert.ok(events.indexOf("b1") < events.indexOf("a3"), "другой ключ не ждёт");
});
