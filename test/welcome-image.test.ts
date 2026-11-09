import { strict as assert } from "node:assert";
import { test as nodeTest } from "node:test";

nodeTest("welcomeImage: рендерит PNG через welcome-render", async () => {
  const { welcomeImage } = await import("../src/bot/utils/welcome-image.ts");
  const png = await welcomeImage({ avatar: "", name: "Тестовый участник", server: "Тестовый сервер", count: 1 });
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 900);
  assert.equal(png.readUInt32BE(20), 480);
});
