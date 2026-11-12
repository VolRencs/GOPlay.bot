import { strict as assert } from "node:assert";
import { after, test } from "node:test";

const { apiGet } = await import("../src/components/dashboard/api.ts");
const originalFetch = globalThis.fetch;

function stubFetch(run: () => Promise<Response>): void {
  globalThis.fetch = run as typeof fetch;
}

test("apiGet возвращает данные при успешном ответе", async () => {
  stubFetch(async () => new Response(JSON.stringify({ value: 42 }), { status: 200 }));
  assert.deepEqual(await apiGet<{ value: number }>("/ok"), { ok: true, data: { value: 42 } });
});

test("apiGet отдаёт серверную ошибку, а не пустой fallback", async () => {
  stubFetch(async () => new Response(JSON.stringify({ error: "Нет доступа" }), { status: 403 }));
  const result = await apiGet("/forbidden");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "Нет доступа");
});

test("apiGet обрабатывает битый JSON и сетевую ошибку", async () => {
  stubFetch(async () => new Response("not-json", { status: 200 }));
  const broken = await apiGet("/broken");
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.match(broken.error, /некорректный ответ/i);

  stubFetch(async () => { throw new Error("offline"); });
  const offline = await apiGet("/offline");
  assert.equal(offline.ok, false);
  if (!offline.ok) assert.match(offline.error, /Нет соединения/i);
});

test("apiGet использует текст ошибки по умолчанию, если сервер не вернул JSON", async () => {
  stubFetch(async () => new Response("oops", { status: 500 }));
  const result = await apiGet("/server-error");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Не удалось загрузить данные/i);
});

after(() => { globalThis.fetch = originalFetch; });
