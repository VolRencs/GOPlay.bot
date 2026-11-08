import { Resvg } from "@resvg/resvg-js";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { setImmediate as immediate } from "node:timers/promises";
import { join, resolve } from "node:path";
import { buildWelcomeSvg, imageSize, parseImageConfig, renderWelcomeTemplate, welcomeValues, WELCOME_DESIGN, type WelcomeImageConfig } from "../../lib/welcome.ts";
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
async function withWelcomeSlot<T>(fn: () => Promise<T> | T): Promise<T> {
  if (welcomeActive >= MAX_WELCOME_CONCURRENCY) await new Promise<void>((r) => welcomeQueue.push(r));
  else welcomeActive++;
  try {
    await immediate();
    return await fn();
  } finally {
    welcomeActive--;
    const next = welcomeQueue.shift();
    if (next) { welcomeActive++; next(); }
  }
}
const fontFiles = ["Onest-Regular.ttf", "Onest-Bold.ttf"].map(name => join(process.cwd(), "public", "fonts", name)).filter(existsSync);
const AVATAR_CACHE_MAX = 50;
const avatarCache = new Map<string, string>();

async function avatarData(url: string): Promise<string> {
  const cached = avatarCache.get(url);
  if (cached) { avatarCache.delete(url); avatarCache.set(url, cached); return cached; }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error();
    const bytes = Buffer.from(await response.arrayBuffer());
    const dataUri = `data:${response.headers.get("content-type") ?? "image/png"};base64,${bytes.toBase64()}`;
    if (avatarCache.size >= AVATAR_CACHE_MAX) {
      const oldest = avatarCache.keys().next().value;
      if (oldest !== undefined) avatarCache.delete(oldest);
    }
    avatarCache.set(url, dataUri);
    return dataUri;
  } catch { return url; }
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
  let bgDataUri: string | null = null;
  const backgroundPath = input.backgroundPath;
  if (backgroundVersion !== "none" && backgroundPath) {
    background = await readFile(resolve(DATA_ROOT, "." + backgroundPath)).catch(() => null);
    if (background) bgDataUri = `data:image/${backgroundPath.endsWith(".jpg") ? "jpeg" : backgroundPath.split(".").pop()};base64,${background.toBase64()}`;
  }
  const size = background ? imageSize(background) : WELCOME_DESIGN;
  const avatar = await avatarData(input.avatar);
  const svg = buildWelcomeSvg({ backgroundHref: bgDataUri, backgroundWidth: size.width, backgroundHeight: size.height, avatarHref: avatar, title, subtitle, config });
  const png = await withWelcomeSlot(() => new Resvg(svg, { font: { fontFiles } }).render().asPng());
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
