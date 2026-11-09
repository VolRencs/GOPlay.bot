import { WelcomeRenderer, type Scene } from "welcome-render";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { imageSize, parseImageConfig, renderWelcomeTemplate, welcomeLayout, welcomeValues, WELCOME_DESIGN, type WelcomeImageConfig } from "../../lib/welcome.ts";

const DATA_ROOT = resolve(process.cwd(), "data");
const WELCOME_ROOT = resolve(DATA_ROOT, "uploads/welcome");
const MAX_WELCOME_CONCURRENCY = 2;
const RENDER_CACHE_MAX = 60;
// Bound the render cache: welcome images can be large and are content-addressed.
const RENDER_CACHE_BYTES = 64 * 1024 * 1024;
let renderCacheBytes = 0;
const renderCache = new Map<string, Buffer>();

function cacheRender(key: string, png: Buffer): void {
  const previous = renderCache.get(key);
  if (previous) renderCacheBytes -= previous.length;
  renderCache.set(key, png);
  renderCacheBytes += png.length;
  while (renderCache.size > RENDER_CACHE_MAX || renderCacheBytes > RENDER_CACHE_BYTES) {
    const oldest = renderCache.keys().next().value;
    if (oldest === undefined) break;
    renderCacheBytes -= renderCache.get(oldest)!.length;
    renderCache.delete(oldest);
  }
}

function takeCachedRender(key: string): Buffer | undefined {
  const cached = renderCache.get(key);
  if (!cached) return undefined;
  renderCache.delete(key);
  renderCache.set(key, cached);
  return cached;
}

let welcomeActive = 0;
const welcomeQueue: (() => void)[] = [];
async function withWelcomeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (welcomeActive >= MAX_WELCOME_CONCURRENCY) await new Promise<void>((resolve) => welcomeQueue.push(resolve));
  else welcomeActive++;
  try {
    return await fn();
  } finally {
    welcomeActive--;
    const next = welcomeQueue.shift();
    if (next) { welcomeActive++; next(); }
  }
}

const regularFont = join(process.cwd(), "public", "fonts", "Onest-Regular.ttf");
const boldFont = join(process.cwd(), "public", "fonts", "Onest-Bold.ttf");
let rendererPromise: Promise<WelcomeRenderer> | undefined;

function getRenderer(): Promise<WelcomeRenderer> {
  return (rendererPromise ??= WelcomeRenderer.fromFiles({
    regular: regularFont,
    ...(existsSync(boldFont) ? { bold: boldFont } : {}),
    systemFonts: true,
    cacheBytes: 64 * 1024 * 1024,
    // Uploads are limited to 5 MB by the dashboard, but not by dimensions.
    // 16K / 32 MP lets large photos decode instead of falling back to a gradient.
    maxDimension: 16_384,
    maxPixels: 32 * 1024 * 1024,
  }));
}

const AVATAR_CACHE_MAX = 50;
const avatarCache = new Map<string, Buffer>();

async function avatarBuffer(url: string): Promise<Buffer | null> {
  if (!url) return null;
  const cached = avatarCache.get(url);
  if (cached) { avatarCache.delete(url); avatarCache.set(url, cached); return cached; }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (avatarCache.size >= AVATAR_CACHE_MAX) {
      const oldest = avatarCache.keys().next().value;
      if (oldest !== undefined) avatarCache.delete(oldest);
    }
    avatarCache.set(url, bytes);
    return bytes;
  } catch { return null; }
}

export async function welcomeImage(input: { avatar: string; name: string; username?: string; userId?: string; server: string; count: number; backgroundPath?: string | null; config?: unknown }) {
  const config: WelcomeImageConfig = parseImageConfig(input.config);
  const values = welcomeValues(input);
  const title = renderWelcomeTemplate(config.title, values), subtitle = renderWelcomeTemplate(config.subtitle, values);
  const backgroundVersion = await backgroundFingerprint(input.backgroundPath);
  const cacheKey = JSON.stringify([config, title, subtitle, backgroundVersion, input.avatar]);
  const cached = takeCachedRender(cacheKey);
  if (cached) return cached;

  let background: Buffer | null = null;
  const backgroundPath = input.backgroundPath;
  if (backgroundVersion !== "none" && backgroundPath) {
    background = await readFile(resolve(DATA_ROOT, "." + backgroundPath)).catch(() => null);
  }
  const size = background ? imageSize(background) : WELCOME_DESIGN;
  const [avatar, renderer] = await Promise.all([avatarBuffer(input.avatar), getRenderer()]);
  const layout = welcomeLayout(config, size.width, size.height);
  const scene: Scene = {
    width: size.width,
    height: size.height,
    ...(background ? { background, backgroundKey: backgroundVersion } : {}),
    overlay: { color: "#000000", opacity: 0.25 },
    ...(avatar ? { avatar, avatarEllipse: layout.avatar } : {}),
    texts: [
      { text: title, x: layout.title.x, y: layout.title.y, size: layout.title.size, color: layout.title.color, weight: 700 },
      { text: subtitle, x: layout.subtitle.x, y: layout.subtitle.y, size: layout.subtitle.size, color: layout.subtitle.color },
    ],
  };
  const png = await withWelcomeSlot(() => renderer.renderAsync(scene));
  cacheRender(cacheKey, png);
  return png;
}

async function backgroundFingerprint(path?: string | null): Promise<string> {
  if (!path || !/^\/uploads\/welcome\/\d{15,22}-welcome\.(png|jpg|webp)$/.test(path)) return "none";
  const candidate = resolve(DATA_ROOT, "." + path);
  if (!candidate.startsWith(WELCOME_ROOT + "/")) return "none";
  try {
    const info = await stat(candidate);
    return `${info.mtimeMs}:${info.size}`;
  } catch { return "none"; }
}
