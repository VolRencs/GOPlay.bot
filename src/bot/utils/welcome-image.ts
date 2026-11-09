import type { Scene } from "welcome-render";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  parseImageConfig,
  renderWelcomeTemplate,
  welcomeLayout,
  welcomeValues,
  WELCOME_DESIGN,
  type WelcomeImageConfig,
} from "../../lib/welcome.ts";
import {
  getWelcomeRenderer,
  normalizeWelcomeImage,
  probeWelcomeImage,
} from "../../lib/welcome-render.ts";
import { logger } from "../../lib/logger.ts";

const DATA_ROOT = resolve(process.cwd(), "data");
const WELCOME_ROOT = resolve(DATA_ROOT, "uploads/welcome");
const MAX_WELCOME_CONCURRENCY = 2;
const RENDER_CACHE_MAX = 60;
const RENDER_CACHE_BYTES = 32 * 1024 * 1024;
let renderCacheBytes = 0;
const renderCache = new Map<string, Buffer>();

function cacheRender(key: string, image: Buffer): void {
  const previous = renderCache.get(key);
  if (previous) renderCacheBytes -= previous.length;
  renderCache.set(key, image);
  renderCacheBytes += image.length;
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

const BACKGROUND_CACHE_MAX = 8;
const BACKGROUND_CACHE_BYTES = 24 * 1024 * 1024;
let backgroundCacheBytes = 0;
const backgroundCache = new Map<string, Buffer>();

function takeBackground(key: string): Buffer | undefined {
  const cached = backgroundCache.get(key);
  if (!cached) return undefined;
  backgroundCache.delete(key);
  backgroundCache.set(key, cached);
  return cached;
}

function cacheBackground(key: string, data: Buffer): void {
  const previous = backgroundCache.get(key);
  if (previous) backgroundCacheBytes -= previous.length;
  backgroundCache.set(key, data);
  backgroundCacheBytes += data.length;
  while (backgroundCache.size > BACKGROUND_CACHE_MAX || backgroundCacheBytes > BACKGROUND_CACHE_BYTES) {
    const oldest = backgroundCache.keys().next().value;
    if (oldest === undefined) break;
    backgroundCacheBytes -= backgroundCache.get(oldest)!.length;
    backgroundCache.delete(oldest);
  }
}

type PreparedBackground = { data: Buffer; width: number; height: number; key: string };
const PREPARED_CACHE_MAX = 8;
const PREPARED_CACHE_BYTES = 8 * 1024 * 1024;
let preparedCacheBytes = 0;
const preparedCache = new Map<string, PreparedBackground>();

function takePrepared(key: string): PreparedBackground | undefined {
  const cached = preparedCache.get(key);
  if (!cached) return undefined;
  preparedCache.delete(key);
  preparedCache.set(key, cached);
  return cached;
}

function cachePrepared(key: string, value: PreparedBackground): void {
  const previous = preparedCache.get(key);
  if (previous) preparedCacheBytes -= previous.data.length;
  preparedCache.set(key, value);
  preparedCacheBytes += value.data.length;
  while (preparedCache.size > PREPARED_CACHE_MAX || preparedCacheBytes > PREPARED_CACHE_BYTES) {
    const oldest = preparedCache.keys().next().value;
    if (oldest === undefined) break;
    preparedCacheBytes -= preparedCache.get(oldest)!.data.length;
    preparedCache.delete(oldest);
  }
}

const AVATAR_CACHE_MAX = 50;
const AVATAR_CACHE_BYTES = 8 * 1024 * 1024;
const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
const AVATAR_FAILURE_TTL = 60_000;
const AVATAR_FAILURE_MAX = 100;
let avatarCacheBytes = 0;
const avatarCache = new Map<string, Buffer>();
const avatarFailures = new Map<string, number>();
const avatarInflight = new Map<string, Promise<Buffer | null>>();

function takeAvatar(url: string): Buffer | undefined {
  const cached = avatarCache.get(url);
  if (!cached) return undefined;
  avatarCache.delete(url);
  avatarCache.set(url, cached);
  return cached;
}

function cacheAvatar(url: string, data: Buffer): void {
  const previous = avatarCache.get(url);
  if (previous) avatarCacheBytes -= previous.length;
  avatarCache.set(url, data);
  avatarCacheBytes += data.length;
  while (avatarCache.size > AVATAR_CACHE_MAX || avatarCacheBytes > AVATAR_CACHE_BYTES) {
    const oldest = avatarCache.keys().next().value;
    if (oldest === undefined) break;
    avatarCacheBytes -= avatarCache.get(oldest)!.length;
    avatarCache.delete(oldest);
  }
}

function avatarFailureActive(url: string): boolean {
  const until = avatarFailures.get(url);
  if (!until) return false;
  if (until > Date.now()) return true;
  avatarFailures.delete(url);
  return false;
}

function markAvatarFailure(url: string): void {
  if (avatarFailures.size >= AVATAR_FAILURE_MAX) {
    const oldest = avatarFailures.keys().next().value;
    if (oldest !== undefined) avatarFailures.delete(oldest);
  }
  avatarFailures.set(url, Date.now() + AVATAR_FAILURE_TTL);
}

async function fetchAvatar(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      logger.warn("[WELCOME] Не удалось загрузить аватар", url, response.status);
      markAvatarFailure(url);
      return null;
    }
    const type = response.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      logger.warn("[WELCOME] Аватар вернул не изображение", url, type);
      markAvatarFailure(url);
      return null;
    }
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > AVATAR_MAX_BYTES) {
      logger.warn("[WELCOME] Аватар больше лимита", url, length);
      markAvatarFailure(url);
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > AVATAR_MAX_BYTES) {
      logger.warn("[WELCOME] Аватар больше лимита", url, bytes.length);
      markAvatarFailure(url);
      return null;
    }
    cacheAvatar(url, bytes);
    return bytes;
  } catch (error) {
    logger.warn("[WELCOME] Не удалось загрузить аватар", url, error);
    markAvatarFailure(url);
    return null;
  }
}

function avatarBuffer(url: string): Promise<Buffer | null> {
  if (!url) return Promise.resolve(null);
  const cached = takeAvatar(url);
  if (cached) return Promise.resolve(cached);
  if (avatarFailureActive(url)) return Promise.resolve(null);
  const existing = avatarInflight.get(url);
  if (existing) return existing;
  const pending = fetchAvatar(url).finally(() => avatarInflight.delete(url));
  avatarInflight.set(url, pending);
  return pending;
}

type BackgroundFingerprint = { key: string; path: string | null; expected: boolean };

async function backgroundFingerprint(path?: string | null): Promise<BackgroundFingerprint> {
  if (!path) return { key: "none", path: null, expected: false };
  if (!/^\/uploads\/welcome\/\d{15,22}-welcome\.(png|jpg|webp)$/.test(path)) {
    return { key: `${path}:invalid`, path: null, expected: true };
  }
  const candidate = resolve(DATA_ROOT, "." + path);
  if (!candidate.startsWith(WELCOME_ROOT + "/")) {
    return { key: `${path}:invalid`, path: null, expected: true };
  }
  try {
    const info = await stat(candidate);
    return {
      key: `${path}:${info.mtimeMs}:${info.size}`,
      path: candidate,
      expected: true,
    };
  } catch {
    return { key: `${path}:missing`, path: candidate, expected: true };
  }
}

async function loadBackground(state: BackgroundFingerprint): Promise<Buffer | null> {
  const cached = takeBackground(state.key);
  if (cached) return cached;
  if (!state.path) return null;
  const data = await readFile(state.path).catch((error: unknown) => {
    logger.warn("[WELCOME] Не удалось прочитать фон", state.path, error);
    return null;
  });
  if (!data) return null;
  cacheBackground(state.key, data);
  return data;
}

async function prepareBackground(data: Buffer, key: string): Promise<PreparedBackground> {
  const cached = takePrepared(key);
  if (cached) return cached;
  const info = await probeWelcomeImage(data);
  if (
    info.orientation === 1
    && info.width <= MAX_IMAGE_DIMENSION
    && info.height <= MAX_IMAGE_DIMENSION
    && info.width * info.height <= MAX_IMAGE_PIXELS
  ) {
    return { data, width: info.width, height: info.height, key };
  }
  const normalized = await normalizeWelcomeImage(data, {
    maxDimension: MAX_IMAGE_DIMENSION,
    maxPixels: MAX_IMAGE_PIXELS,
    format: "jpeg",
    quality: 88,
  });
  const prepared = {
    data: normalized.data,
    width: normalized.width,
    height: normalized.height,
    key: `${key}|normalized`,
  };
  cachePrepared(key, prepared);
  return prepared;
}

export async function welcomeImage(input: { avatar: string; name: string; username?: string; userId?: string; server: string; count: number; backgroundPath?: string | null; config?: unknown }) {
  const config: WelcomeImageConfig = parseImageConfig(input.config);
  const values = { ...welcomeValues(input), userAvatar: "", serverIcon: "" };
  const title = renderWelcomeTemplate(config.title, values);
  const subtitle = renderWelcomeTemplate(config.subtitle, values);
  const background = await backgroundFingerprint(input.backgroundPath);
  const cacheKey = JSON.stringify([config, title, subtitle, background.key, input.avatar]);
  const cached = takeCachedRender(cacheKey);
  if (cached) return cached;

  const result = await withWelcomeSlot(async () => {
    let prepared: PreparedBackground | null = null;
    if (background.expected) {
      const data = await loadBackground(background);
      if (!data) throw new Error(`welcome background is unavailable: ${background.path}`);
      prepared = await prepareBackground(data, background.key);
    }

    const avatar = await avatarBuffer(input.avatar);
    const avatarOk = !input.avatar || avatar !== null;

    const size = prepared ? { width: prepared.width, height: prepared.height } : WELCOME_DESIGN;
    const layout = welcomeLayout(config, size.width, size.height);
    const jpeg = size.width * size.height > 1_500_000;
    const scene: Scene = {
      width: size.width,
      height: size.height,
      ...(prepared ? { background: prepared.data, backgroundKey: prepared.key } : {}),
      overlay: { color: "#000000", opacity: 0.25 },
      ...(avatar ? { avatar, avatarEllipse: layout.avatar } : {}),
      texts: [
        { text: title, x: layout.title.x, y: layout.title.y, size: layout.title.size, color: layout.title.color, weight: 700 },
        { text: subtitle, x: layout.subtitle.x, y: layout.subtitle.y, size: layout.subtitle.size, color: layout.subtitle.color },
      ],
      format: jpeg ? "jpeg" : "png",
      ...(jpeg ? { quality: 90 } : {}),
      strictBackground: Boolean(prepared),
    };
    const renderer = await getWelcomeRenderer();
    const image = await renderer.renderAsync(scene);
    return { image, cacheable: avatarOk };
  });

  if (result.cacheable) cacheRender(cacheKey, result.image);
  return result.image;
}
