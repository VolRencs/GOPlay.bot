import { strict as assert } from "node:assert";
import { test } from "node:test";

const { rejectOversized } = await import("../src/lib/uploads.ts");

const request = (length?: string) => ({
  headers: new Headers(length === undefined ? {} : { "content-length": length }),
}) as Request;

test("rejectOversized требует Content-Length", () => {
  assert.equal(rejectOversized(request())?.status, 411);
});

test("rejectOversized отклоняет битый или отрицательный размер", () => {
  for (const value of ["abc", "-1", "1.5", "NaN"]) {
    assert.equal(rejectOversized(request(value), 10)?.status, 400, value);
  }
});

test("rejectOversized блокирует тело больше лимита", () => {
  assert.equal(rejectOversized(request("11"), 10)?.status, 413);
  assert.equal(rejectOversized(request("10"), 10), null);
});
