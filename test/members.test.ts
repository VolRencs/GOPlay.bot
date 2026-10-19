import { test } from "node:test";
import assert from "node:assert/strict";
import { memberRoleDiff } from "../src/bot/utils/members.ts";

test("memberRoleDiff: empty old cache yields all new roles except guild", () => {
  const { added, removed } = memberRoleDiff([], ["r1", "r2", "guild"], "guild");
  assert.deepStrictEqual(added, ["r1", "r2"]);
  assert.deepStrictEqual(removed, []);
});

test("memberRoleDiff: detects added and removed roles", () => {
  const { added, removed } = memberRoleDiff(["r1", "r2"], ["r2", "r3"], "guild");
  assert.deepStrictEqual(added, ["r3"]);
  assert.deepStrictEqual(removed, ["r1"]);
});

test("memberRoleDiff: no changes", () => {
  const { added, removed } = memberRoleDiff(["r1"], ["r1"], "guild");
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, []);
});
