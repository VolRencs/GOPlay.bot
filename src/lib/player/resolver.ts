
import { spawn } from "node:child_process";
import { logger } from "../../bot/utils/logger.ts";
import { MAX_DURATION_SECONDS, MAX_PLAYLIST, type Track } from "./types.ts";

export const YT_DLP = process.env.YT_DLP_PATH ?? "yt-dlp";
export const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

// Страховки сети (быстрый фейл вместо зависаний) + env-флаги админа.
const YT_DLP_EXTRA = (process.env.YT_DLP_EXTRA_ARGS ?? "").split(/\s+/).filter(Boolean);
export function ytDlpArgs(...own: string[]): string[] {
  return ["--no-warnings", "--socket-timeout", "15", "--retries", "2", "--fragment-retries", "2", ...YT_DLP_EXTRA, ...own];
}

// SSRF: generic extractor ходит по любым хостам — ссылки только доверенные, до spawn.
const ALLOWED_MEDIA_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be",
]);

export function isAllowedMediaUrl(query: string): boolean {
  try {
    const url = new URL(query);
    return (url.protocol === "https:" || url.protocol === "http:") && ALLOWED_MEDIA_HOSTS.has(url.hostname.toLowerCase());
  } catch { return false; }
}

/** Не-URL и чужие хосты отклоняются. */
export const safeYtDlpTarget = (query: string): string | null => (isAllowedMediaUrl(query) ? query : null);

function probeBinary(command: string, args: string[], capture: boolean, verdict: (code: number | null, stdout: string) => boolean): Promise<boolean> {
  return new Promise(resolve => {
    const proc = spawn(command, args, { stdio: capture ? ["ignore", "pipe", "ignore"] : "ignore", windowsHide: true });
    let stdout = "";
    if (capture) proc.stdout!.on("data", (chunk: Buffer) => { stdout += String(chunk); });
    const watchdog = setTimeout(() => proc.kill(), 5_000);
    proc.once("error", () => { clearTimeout(watchdog); resolve(false); });
    proc.once("close", code => { clearTimeout(watchdog); resolve(verdict(code, stdout)); });
  });
}

let ytDlpProbe: Promise<boolean> | null = null;
let ffmpegProbe: Promise<boolean> | null = null;
let opusProbe: Promise<boolean> | null = null;

export const probeYtDlp = () => (ytDlpProbe ??= probeBinary(YT_DLP, ytDlpArgs("--version"), false, code => code === 0));
export const probeFfmpeg = () => (ffmpegProbe ??= probeBinary(FFMPEG, ["-version"], false, code => code === 0));
// Сборка ffmpeg обязана содержать libopus: Opus кодирует сам ffmpeg.
export const probeOpus = () => (opusProbe ??= probeBinary(FFMPEG, ["-hide_banner", "-encoders"], true, (code, out) => code === 0 && /libopus/i.test(out)));

// Кэш метаданных: стабильные поля; форматы не кэшируются (ротация YouTube).
type SingleMeta = { at: number; title: string; duration: number; mediaUrl?: string; mediaUrlExpiresAt?: number };
const singleMeta = new Map<string, SingleMeta>();
const listMeta = new Map<string, { at: number; tracks: Track[] }>();
const SINGLE_META_TTL = 24 * 3_600_000;
const LIST_META_TTL = 6 * 3_600_000;
const MEDIA_URL_TTL_MS = 30 * 60_000; // подписанные ссылки googlevideo живут дольше, но консервативный кап страхует
const META_CACHE_CAP = 500;

function evictOldest<K, V>(map: Map<K, V>): void {
  if (map.size >= META_CACHE_CAP) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

/** Канонический ключ на видео: host-префиксы срезаны, list/t/si/feature/pp
 *  отброшены, shorts/embed/youtu.be/music.youtube свёрнуты в watch?v=. */
function normalizeTrackKey(query: string): string {
  const trimmed = query.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `q:${trimmed.toLowerCase()}`;
  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.replace(/^(?:www|m|music)\./i, "").toLowerCase();
    for (const junk of ["list", "t", "si", "feature", "pp"]) url.searchParams.delete(junk);
    const path = url.pathname.replace(/\/+$/, "");
    const short = path.match(/^\/(shorts|embed)\/([\w-]{5,})$/i);
    if (url.hostname === "youtu.be") return `https://youtube.com/watch?v=${path.slice(1)}`;
    if (short) return `https://youtube.com/watch?v=${short[2]}`;
    return `https://${url.hostname}${path}${url.search}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

/** Выбор прямого аудио-URL из -J: зеркалирует лестницу форматов yt-dlp.
 *  Манифесты (m3u8/dash) пропускаем — медленный старт фрагментов у ffmpeg. */
export function pickAudioUrl(meta: Record<string, unknown>): string | null {
  type Fmt = { url?: unknown; protocol?: unknown; vcodec?: unknown; acodec?: unknown; abr?: unknown; tbr?: unknown };
  const usable = (fmt: Fmt): fmt is Fmt & { url: string } =>
    typeof fmt.url === "string" && /^https:\/\//i.test(fmt.url) && typeof fmt.protocol === "string" && /^https?$/.test(fmt.protocol);
  const rate = (fmt: Fmt) => Math.max(typeof fmt.abr === "number" ? fmt.abr : 0, typeof fmt.tbr === "number" ? fmt.tbr : 0);
  const formats = (Array.isArray(meta.formats) ? meta.formats : []).filter(usable) as (Fmt & { url: string })[];
  const audioOnly = formats.filter(f => {
    const v = typeof f.vcodec === "string" ? f.vcodec : "none";
    return v === "none" || v === "";
  });
  const opus = audioOnly.filter(f => typeof f.acodec === "string" && f.acodec.startsWith("opus"));
  const loudest = formats.length ? formats.reduce((a, b) => (rate(b) > rate(a) ? b : a)) : null;
  const best = opus.length ? opus.reduce((a, b) => (rate(b) > rate(a) ? b : a))
    : audioOnly.length ? audioOnly.reduce((a, b) => (rate(b) > rate(a) ? b : a))
    : loudest;
  return best?.url ?? null;
}

/** Полный -J как есть; обрезанный капом чинится срезом до последней записи. */
export function parseYtDlpMeta(raw: string, capped: boolean): Record<string, unknown> | null {
  try { return JSON.parse(raw); } catch { /* ниже — восстановление */ }
  if (!capped) return null;
  const cut = raw.slice(0, Math.max(0, raw.lastIndexOf("}") + 1)).replace(/,\s*$/, "");
  for (const candidate of [`${cut}] }`, `${cut}}`]) {
    try { return JSON.parse(candidate); } catch { /* следующая форма */ }
  }
  return null;
}

const RESOLVE_CONCURRENCY = 3;
let activeResolves = 0;
const resolveQueue: (() => void)[] = [];
async function withResolveSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeResolves >= RESOLVE_CONCURRENCY) await new Promise<void>(resolve => resolveQueue.push(resolve));
  else activeResolves++;
  try { return await fn(); } finally {
    activeResolves--;
    const next = resolveQueue.shift();
    if (next) { activeResolves++; next(); }
  }
}

function runYtDlpJson(query: string): Promise<{ meta: Record<string, unknown> | null; error?: string }> {
  return withResolveSlot(() => runYtDlpJsonOnce(query));
}

function runYtDlpJsonOnce(query: string): Promise<{ meta: Record<string, unknown> | null; error?: string }> {
  return new Promise(resolve => {
    const target = safeYtDlpTarget(query);
    if (!target) return resolve({ meta: null, error: "unsupported-url" });
    // Кап плейлиста отдаём yt-dlp (--playlist-items): бесконечные Mix'ы иначе
    // рвут JSON на RAM-капе и не парсятся. Watchdog против зависшего спавна.
    const proc = spawn(YT_DLP, ytDlpArgs("--skip-download", "--flat-playlist", "--playlist-items", `1-${MAX_PLAYLIST}`, "-J", target), { windowsHide: true });
    const chunks: Buffer[] = [];
    let size = 0, errTail = "", capped = false;
    const watchdog = setTimeout(() => proc.kill(), 60_000);
    proc.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk); // буферы, не строки: граница chunk'а может резать UTF-8
      size += chunk.length;
      if (size > 8 * 1024 * 1024 && !capped) { capped = true; proc.kill(); }
    });
    proc.stderr.on("data", chunk => { errTail = `${errTail}${chunk}`.slice(-400); });
    proc.once("error", () => { clearTimeout(watchdog); resolve({ meta: null, error: "yt-dlp failed to spawn" }); });
    proc.once("close", code => {
      clearTimeout(watchdog);
      if (code !== 0) {
        logger.warn("[MUSIC] yt-dlp завершился с ошибкой", code, errTail.trim());
        return resolve({ meta: null, error: errTail.trim().slice(-300) || `код ${code}` });
      }
      const out = Buffer.concat(chunks).toString("utf8");
      const meta = parseYtDlpMeta(out, capped);
      if (meta) return resolve({ meta });
      logger.warn("[MUSIC] yt-dlp вернул не-JSON ответ", out.slice(0, 200));
      resolve({ meta: null, error: "non-json output" });
    });
  });
}

// Частая причина на серверных IP: «Sign in to confirm you're not a bot».
const BOTCHECK_RE = /confirm|sign in|cookies/i;
export const isBotcheckError = (text: string): boolean => BOTCHECK_RE.test(text);

// Хосты одиночного видео: как в ALLOWED_MEDIA_HOSTS, но без music.youtube.com —
// он не подходил и прежнему fast-path-регэкспу.
const SINGLE_VIDEO_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"]);

/** Одиночное YouTube-видео (watch/shorts/youtu.be) без list=: достаточно одной
 *  -J экстракции, название и длительность доедут параллельной гидрацией. */
export function isSingleYouTubeVideoUrl(query: string): boolean {
  if (!/^https?:\/\//i.test(query)) return false;
  try {
    const url = new URL(query);
    const host = url.hostname.toLowerCase();
    if (!SINGLE_VIDEO_HOSTS.has(host)) return false;
    if (url.searchParams.has("list")) return false;
    if (host === "youtu.be" || host === "www.youtu.be") return url.pathname.slice(1) !== "";
    const m = url.pathname.match(/^\/(watch|shorts)(?:\/([^/]+))?$/i);
    if (!m) return false;
    return (m[2] ?? url.searchParams.get("v") ?? "") !== "";
  } catch { return false; }
}

function trackFromFullMeta(meta: Record<string, unknown>, fallbackQuery: string, requestedBy: string): Track | null {
  const duration = typeof meta.duration === "number" ? meta.duration : 0;
  if (duration > MAX_DURATION_SECONDS) return null;
  const mediaUrl = pickAudioUrl(meta);
  const expiresAt = Date.now() + MEDIA_URL_TTL_MS;
  const track: Track = { query: String(meta.webpage_url ?? fallbackQuery), title: String(meta.title ?? fallbackQuery), requestedBy, ...(duration > 0 ? { duration } : {}) };
  // Прямой URL экономит вторую полную экстракцию на старте стрима.
  if (mediaUrl) { track.mediaUrl = mediaUrl; track.mediaUrlExpiresAt = expiresAt; }
  evictOldest(singleMeta);
  singleMeta.set(normalizeTrackKey(track.query), { at: Date.now(), title: track.title, duration, ...(mediaUrl ? { mediaUrl, mediaUrlExpiresAt: expiresAt } : {}) });
  return track;
}

/** Ссылка → треки: плейлист до MAX_PLAYLIST позиций, результат кэшируется. */
export async function resolveTracks(query: string, requestedBy: string): Promise<{ tracks: Track[]; error: string | null }> {
  const cacheKey = normalizeTrackKey(query);
  const cached = listMeta.get(cacheKey);
  if (cached && Date.now() - cached.at < LIST_META_TTL) return { tracks: cached.tracks.map(track => ({ ...track, requestedBy })), error: null };
  const { meta, error } = await runYtDlpJson(query);
  if (!meta) return { tracks: [], error: isBotcheckError(error ?? "") ? "botcheck" : error ?? "unknown" };
  if (meta._type !== "playlist") {
    const track = trackFromFullMeta(meta, query, requestedBy);
    return track ? { tracks: [track], error: null } : { tracks: [], error: "too-long" };
  }
  const entries = Array.isArray(meta.entries) ? meta.entries : [];
  // Одиночная flat-запись приходит без форматов: добираем полный -J.
  if (entries.length === 1) {
    const raw = String(entries[0]!.url ?? entries[0]!.id ?? "");
    if (raw) {
      const target = raw.startsWith("http") ? raw : `https://www.youtube.com/watch?v=${raw}`;
      const full = await runYtDlpJson(target);
      if (full.meta && full.meta._type !== "playlist") {
        const track = trackFromFullMeta(full.meta, target, requestedBy);
        if (track) return { tracks: [track], error: null };
      }
    }
  }
  const tracks: Track[] = [];
  for (const entry of entries.slice(0, MAX_PLAYLIST)) {
    const raw = String(entry.url ?? entry.id ?? "");
    if (!raw) continue;
    const duration = typeof entry.duration === "number" && entry.duration > 0 ? entry.duration : undefined;
    tracks.push({
      query: raw.startsWith("http") ? raw : `https://www.youtube.com/watch?v=${raw}`,
      title: String(entry.title ?? raw),
      requestedBy,
      ...(duration ? { duration } : {}),
    });
  }
  if (tracks.length) {
    evictOldest(listMeta);
    listMeta.set(cacheKey, { at: Date.now(), tracks });
  }
  return { tracks, error: null };
}

// Политика «превышение длительности» принадлежит сессии; резолвер только сообщает.
type HydrateHooks = {
  isCurrent: (track: Track) => boolean;
  onTooLong: (guildId: string, track: Track) => void;
  onChange: (guildId: string) => void;
};
let hydrateHooks: HydrateHooks | null = null;
export function setHydrateHooks(hooks: HydrateHooks): void { hydrateHooks = hooks; }

/** Позднее обогащение трека: название, длина, прямой URL. Ошибки тихи — за
 *  ними следит стрим. */
export function hydrateTrackMeta(track: Track, guildId: string): void {
  if (track.metaPending) return;
  track.metaPending = true;
  const key = normalizeTrackKey(track.query);
  const cached = singleMeta.get(key);
  if (cached && Date.now() - cached.at < SINGLE_META_TTL) {
    applyHydration(track, guildId, cached.title, cached.duration, cached.mediaUrl, cached.mediaUrlExpiresAt);
    return;
  }
  void runYtDlpJson(track.query).then(({ meta }) => {
    if (!meta || meta._type === "playlist") { track.metaPending = false; return; }
    const duration = typeof meta.duration === "number" ? meta.duration : 0;
    const mediaUrl = pickAudioUrl(meta);
    evictOldest(singleMeta);
    singleMeta.set(key, { at: Date.now(), title: String(meta.title ?? track.query), duration, ...(mediaUrl ? { mediaUrl, mediaUrlExpiresAt: Date.now() + MEDIA_URL_TTL_MS } : {}) });
    applyHydration(track, guildId, String(meta.title ?? track.title), duration, mediaUrl ?? undefined, mediaUrl ? Date.now() + MEDIA_URL_TTL_MS : undefined);
  }).catch(() => { track.metaPending = false; });
}

function applyHydration(track: Track, guildId: string, title: string, duration: number, mediaUrl?: string, expiresAt?: number): void {
  track.title = title;
  if (duration > 0) track.duration = duration;
  if (mediaUrl) { track.mediaUrl = mediaUrl; if (expiresAt !== undefined) track.mediaUrlExpiresAt = expiresAt; }
  if (duration > MAX_DURATION_SECONDS) {
    logger.info("[MUSIC] Трек длиннее лимита — пропускаю", guildId, title);
    // За время гидрации мог прозвучать Skip: страдает только текущий трек.
    if (hydrateHooks?.isCurrent(track)) hydrateHooks.onTooLong(guildId, track);
  }
  hydrateHooks?.onChange(guildId);
}
