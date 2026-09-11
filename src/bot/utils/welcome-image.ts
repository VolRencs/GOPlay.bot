import { Resvg } from "@resvg/resvg-js";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildWelcomeSvg, imageSize, parseImageConfig, renderWelcomeTemplate, WELCOME_DESIGN, type WelcomeImageConfig } from "../../lib/welcome.ts";
const PUBLIC_ROOT = resolve(process.cwd(), "public");
const WELCOME_ROOT = resolve(PUBLIC_ROOT, "uploads/welcome");
const MAX_WELCOME_CONCURRENCY = 2;
// Контентно-адресный кэш рендера: одинаковые входы (текст, конфиг, версия
// фона, аватар) переиспользуют готовый PNG вместо нового Resvg. Ключ включает
// mtime фона — свежезагруженный фон не попадёт в устаревшую запись.
// Текст не должен зависеть от шрифтов хоста: на headless-сервере их нет, и
// Resvg молча не рисует глифы. Noto Sans бандлится и грузится явно —
// текст одинаков везде.
// При любом сбое вернётся исходный URL и пустой аватар, а не битая картинка;
// малый FIFO аватаров экономит повторы CDN/base64.
const RENDER_CACHE_MAX = 60;
// Байтовый бюджет поверх FIFO-капа: 60 PNG фонов до 4K могут держать сотни
// мегабайт RSS, поэтому при превышении лимита выметаем самые старые записи
// независимо от их количества.
const RENDER_CACHE_BYTES = 64 * 1024 * 1024;
let renderCacheBytes = 0;
const renderCache = new Map<string, Buffer>();

function cacheRender(key: string, png: Buffer): void {
  // Конкурентный дубликат того же ключа перезаписывает значение: без вычета
  // старой длины байтовый бюджет тает необратимо (вытеснение гасит только
  // учтённую сумму, а не реальный объём карты).
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
  // LRU-touch: переустановка сдвигает ключ в хвост вытеснения.
  renderCache.delete(key);
  renderCache.set(key, cached);
  return cached;
}
let welcomeActive = 0;
const welcomeQueue: (() => void)[] = [];
async function withWelcomeSlot<T>(fn: () => Promise<T> | T): Promise<T> {
  if (welcomeActive >= MAX_WELCOME_CONCURRENCY) await new Promise<void>((r) => welcomeQueue.push(r));
  welcomeActive++;
  try {
    await new Promise<void>((r) => setImmediate(r));
    return await fn();
  } finally {
    welcomeActive--;
    const next = welcomeQueue.shift();
    if (next) next();
  }
}
const fontFiles = ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"].map(name => join(process.cwd(), "public", "fonts", name)).filter(existsSync);
const AVATAR_CACHE_MAX = 50;
const avatarCache = new Map<string, string>(); // url → data URI

async function avatarData(url: string): Promise<string> {
  const cached = avatarCache.get(url);
  if (cached) { avatarCache.delete(url); avatarCache.set(url, cached); return cached; }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error();
    const bytes = Buffer.from(await response.arrayBuffer());
    const dataUri = `data:${response.headers.get("content-type") ?? "image/png"};base64,${bytes.toString("base64")}`;
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
  const values = { user: input.name, username: input.username ?? input.name, displayName: input.name, server: input.server, count: String(input.count), memberCount: String(input.count), userId: input.userId ?? "", userAvatar: input.avatar, serverIcon: "" };
  const title = renderWelcomeTemplate(config.title, values), subtitle = renderWelcomeTemplate(config.subtitle, values);
  // Кэш проверяем ДО любой тяжёлой работы: фон с диска, CDN-аватар и base64
  // нужны только на реальном промахе.
  const backgroundVersion = await backgroundFingerprint(input.backgroundPath);
  const cacheKey = JSON.stringify([config, title, subtitle, backgroundVersion, input.avatar]);
  const cached = takeCachedRender(cacheKey);
  if (cached) return cached;

  let background: Buffer | null = null;
  let bgDataUri: string | null = null;
  const backgroundPath = input.backgroundPath;
  // backgroundVersion === "none" означает инвалид: читать с диска нечего.
  if (backgroundVersion !== "none" && backgroundPath) {
    background = await readFile(resolve(PUBLIC_ROOT, "." + backgroundPath)).catch(() => null);
    if (background) bgDataUri = `data:image/${backgroundPath.endsWith(".jpg") ? "jpeg" : backgroundPath.split(".").pop()};base64,${background.toString("base64")}`;
  }
  const size = background ? imageSize(background) : WELCOME_DESIGN;
  const avatar = await avatarData(input.avatar);
  const svg = buildWelcomeSvg({ backgroundHref: bgDataUri, backgroundWidth: size.width, backgroundHeight: size.height, avatarHref: avatar, title, subtitle, config });
  const png = await withWelcomeSlot(() => new Resvg(svg, { font: { fontFiles } }).render().asPng());
  cacheRender(cacheKey, png);
  return png;
}

/** Отпечаток фонового файла ("mtime:size" | "none") — читает только метаданные. */
async function backgroundFingerprint(path?: string | null): Promise<string> {
  if (!path || !/^\/uploads\/welcome\/\d{15,22}-welcome\.(png|jpg|webp)$/.test(path)) return "none";
  const candidate = resolve(PUBLIC_ROOT, "." + path);
  if (!(candidate.startsWith(WELCOME_ROOT + "/") || candidate === WELCOME_ROOT)) return "none";
  try {
    const info = await stat(candidate);
    return `${info.mtimeMs}:${info.size}`;
  } catch { return "none"; }
}