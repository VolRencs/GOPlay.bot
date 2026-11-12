import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.DISCORD_TOKEN = "test-token";
process.env.DISCORD_CLIENT_ID = "bot-user";

const { createGuildResourceValidator, loadGuildResourceSnapshot, assignableGuildRoles, validateSnapshot } = await import("../src/lib/guild-resources.ts");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const channels = [
  { id: "c-text", name: "general", type: 0, position: 1 },
  { id: "c-voice", name: "voice", type: 2, position: 2 },
  { id: "c-category", name: "category", type: 4, position: 0 },
];
const roles = [
  { id: "r-everyone", name: "@everyone", managed: false, position: 0 },
  { id: "r-bot", name: "Bot", managed: false, position: 10 },
  { id: "r-low", name: "Low", managed: false, position: 1 },
  { id: "r-high", name: "High", managed: false, position: 20 },
];

const fetcher = async (path: string): Promise<Response> => {
  if (path === "/guilds/g1/channels") return json(channels);
  if (path === "/guilds/g1/roles") return json(roles);
  if (path === "/guilds/g1/members/bot-user") return json({ roles: ["r-bot"] });
  if (path === "/channels/c-text/messages/m1") return json({ id: "m1" });
  if (path === "/guilds/g2/channels") return new Response(null, { status: 500 });
  return new Response(null, { status: 404 });
};

const validator = createGuildResourceValidator(fetcher);

test("snapshot загружается и assignable-роли считаются от роли бота", async () => {
  const snapshot = await loadGuildResourceSnapshot("g1", fetcher);
  assert.equal(snapshot.channels.length, 3);
  assert.equal(snapshot.roles.length, 4);
  assert.deepEqual([...snapshot.botRoleIds!], ["r-bot"]);
  assert.deepEqual(assignableGuildRoles(snapshot)!.map(role => role.id), ["r-everyone", "r-low"]);
  assert.deepEqual(validateSnapshot(snapshot, "g1", { channels: { ids: ["c-text"], types: [0] } }), { ok: true });
});

test("чужой или неверный по типу канал отклоняется", async () => {
  const missing = await validator.validate("g1", { channels: { ids: ["c-missing"] } });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 400);
  const wrongType = await validator.validate("g1", { channels: { ids: ["c-voice"], types: [0, 5] } });
  assert.equal(wrongType.ok, false);
  if (!wrongType.ok) assert.match(wrongType.error, /неподходящего типа/i);
});

test("роли проверяются на владение, @everyone и иерархию", async () => {
  assert.deepEqual(await validator.validate("g1", { roles: { ids: ["r-low"] } }), { ok: true });
  const everyone = await validator.validate("g1", { roles: { ids: ["r-everyone"] } });
  assert.equal(everyone.ok, false);
  const high = await validator.validate("g1", { roles: { ids: ["r-high"], assignable: true } });
  assert.equal(high.ok, false);
  if (!high.ok) assert.match(high.error, /выше роли бота/i);
  const foreign = await validator.validate("g1", { roles: { ids: ["r-foreign"] } });
  assert.equal(foreign.ok, false);
});

test("сообщение проверяется только внутри канала этого сервера", async () => {
  assert.deepEqual(await validator.validate("g1", { messages: [{ channelId: "c-text", messageId: "m1" }] }), { ok: true });
  const missing = await validator.validate("g1", { messages: [{ channelId: "c-text", messageId: "missing" }] });
  assert.equal(missing.ok, false);
  const foreignChannel = await validator.validate("g1", { messages: [{ channelId: "c-foreign", messageId: "m1" }] });
  assert.equal(foreignChannel.ok, false);
});

test("недоступный Discord даёт 502, отсутствие токена — 503", async () => {
  const unavailable = await validator.validate("g2", { channels: { ids: ["c-text"] } });
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.status, 502);

  const previous = process.env.DISCORD_TOKEN;
  delete process.env.DISCORD_TOKEN;
  try {
    const noToken = await validator.validate("g1", { channels: { ids: ["c-text"] } });
    assert.equal(noToken.ok, false);
    if (!noToken.ok) assert.equal(noToken.status, 503);
  } finally {
    process.env.DISCORD_TOKEN = previous;
  }
});
