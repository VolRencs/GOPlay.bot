import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildWelcomeSvg, clampImageSize, parseImageConfig, welcomeLayout } from "../src/lib/welcome.ts";

test("welcomeLayout: масштабирует дизайн 900x480", () => {
  const config = parseImageConfig(undefined);
  assert.deepEqual(welcomeLayout(config, 900, 480), {
    width: 900,
    height: 480,
    avatar: { cx: 450, cy: 175, rx: 82, ry: 82 },
    title: { x: 450, y: 315, size: 38, color: "#f8fafc" },
    subtitle: { x: 450, y: 360, size: 22, color: "#e2e8f0" },
  });

  const scaled = welcomeLayout(config, 1800, 960);
  assert.deepEqual(scaled.avatar, { cx: 900, cy: 350, rx: 164, ry: 164 });
  assert.deepEqual(scaled.title, { x: 900, y: 630, size: 76, color: "#f8fafc" });
  assert.deepEqual(scaled.subtitle, { x: 900, y: 720, size: 44, color: "#e2e8f0" });
});

test("welcomeLayout: сохраняет SVG-правило scaleX для размеров", () => {
  const config = parseImageConfig(undefined);
  const layout = welcomeLayout(config, 1800, 480);
  assert.deepEqual(layout.avatar, { cx: 900, cy: 175, rx: 164, ry: 164 });
  assert.equal(layout.title.size, 76);
  assert.equal(layout.title.y, 315);
});

test("clampImageSize: ограничивает максимальную сторону пропорционально", () => {
  assert.deepEqual(clampImageSize(8000, 4000), { width: 2560, height: 1280 });
  assert.deepEqual(clampImageSize(2560, 2560), { width: 2000, height: 2000 });
  assert.deepEqual(clampImageSize(900, 480), { width: 900, height: 480 });
  assert.deepEqual(clampImageSize(0, 0), { width: 1, height: 1 });
});

test("buildWelcomeSvg: использует те же координаты, что native-рендер", () => {
  const config = parseImageConfig(undefined);
  const svg = buildWelcomeSvg({
    backgroundWidth: 900,
    backgroundHeight: 480,
    avatarHref: "/avatar.png",
    title: "Новый участник",
    subtitle: "Добро пожаловать",
    config,
  });
  assert.match(svg, /<ellipse cx="450" cy="175" rx="82" ry="82"\/>/);
  assert.match(svg, /<text x="450" y="315"[^>]*font-size="38"/);
  assert.match(svg, /<text x="450" y="360"[^>]*font-size="22"/);
});
