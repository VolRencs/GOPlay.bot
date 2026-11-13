import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { logger } from "../logger.ts";
import { count, time } from "../perf.ts";
import { audioOptions, backendOptions, resolveAudioMedia, resolveMedia, type BackendFailure } from "./backend.ts";
import { MAX_DURATION_SECONDS, MAX_PLAYLIST, type Track } from "./types.ts";
import type { ResolveResult, VideoResult } from "ytrust";

export { probeMusicBackend } from "./backend.ts";

export const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

const ALLOWED_MEDIA_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be",
  "youtube-nocookie.com", "www.youtube-nocookie.com",
]);

export function isAllowedMediaUrl(query: string): boolean {
  try {
    const url = new URL(query);
    return (url.protocol === "https:" || url.protocol === "http:") && ALLOWED_MEDIA_HOSTS.has(url.hostname.toLowerCase());
  } catch { return false; }
}

export function isAllowedStreamUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "googlevideo.com" || host.endsWith(".googlevideo.com")) return true;
    return ALLOWED_MEDIA_HOSTS.has(host);
  } catch { return false; }
}

// SSRF guard: only allowlisted YouTube hosts reach the resolver.
export const safeMediaTarget = (query: string): string | null => (isAllowedMediaUrl(query) ? query : null);

/** Keep signed googlevideo URLs out of logs and error details. */
export function redactMediaUrl(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/g, raw => {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      if (host === "googlevideo.com" || host.endsWith(".googlevideo.com")) {
        return `${url.protocol}//${host}/[redacted]`;
      }
    } catch {  }
    return raw;
  });
}

export function isSingleYouTubeVideoUrl(query: string): boolean {
  if (!/^https?:\/\//i.test(query) || !URL.canParse(query)) return false;
  const url = new URL(query);
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_MEDIA_HOSTS.has(host)) return false;
  if (url.searchParams.has("list")) return false;
  if (host === "youtu.be" || host === "www.youtu.be") return url.pathname.slice(1) !== "";
  const m = url.pathname.match(/^\/(watch|shorts|live|embed|v)(?:\/([^/]+))?$/i);
  if (!m) return false;
  return (m[2] ?? url.searchParams.get("v") ?? "") !== "";
}

async function probeBinary(command: string, args: string[], capture: boolean, verdict: (code: number | null, stdout: string) => boolean): Promise<boolean> {
  const proc = spawn(command, args, { stdio: capture ? ["ignore", "pipe", "ignore"] : "ignore", windowsHide: true, signal: AbortSignal.timeout(5_000) });
  let stdout = "";
  if (capture) proc.stdout!.on("data", (chunk: Buffer) => { stdout += String(chunk); });
  try { return verdict((await once(proc, "close"))[0] as number | null, stdout); } catch { return false; }
}

const PROBE_RETRY_MS = 60_000;
function memoProbe(probe: () => Promise<boolean>): () => Promise<boolean> {
  let cached: Promise<boolean> | null = null;
  let retryAt = 0;
  return () => {
    if (cached) return cached;
    if (Date.now() < retryAt) return Promise.resolve(false);
    const pending = probe();
    cached = pending;
    void pending.then(ok => { if (!ok) { cached = null; retryAt = Date.now() + PROBE_RETRY_MS; } }, () => { cached = null; retryAt = Date.now() + PROBE_RETRY_MS; });
    return pending;
  };
}

export const probeFfmpeg = memoProbe(() => probeBinary(FFMPEG, ["-version"], false, code => code === 0));
export const probeOpus = memoProbe(() => probeBinary(FFMPEG, ["-hide_banner", "-encoders"], true, (code, out) => code === 0 && /libopus/i.test(out)));

type RawFormat = Record<string, unknown>;
type MetaLike = {
  duration?: unknown;
  thumbnail?: unknown;
  thumbnails?: unknown;
  best_audio?: unknown;
  formats?: unknown;
};
type HeaderSource = { http_headers?: unknown };
type ExpirySource = { expires_at?: unknown; url?: unknown };
type CachedMeta = {
  title: string;
  duration: number;
  thumbnail?: string;
  mediaUrl?: string;
  mediaHeaders?: Record<string, string>;
  mediaUrlExpiresAt?: number;
};
const singleMeta = new Map<string, CachedMeta>();
const listMeta = new Map<string, { at: number; tracks: Track[] }>();
const LIST_META_TTL = 6 * 3_600_000;
const MEDIA_URL_TTL_MS = 30 * 60_000;
const MEDIA_RESOLVE_TIMEOUT_MS = 30_000;
const RESOLVE_TIMEOUT_MS = 45_000;
const META_CACHE_CAP = 500;

function evictOldest<K, V>(map: Map<K, V>): void {
  if (map.size >= META_CACHE_CAP) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

export function normalizeTrackKey(query: string): string {
  const trimmed = query.trim();
  if (!/^https?:\/\//i.test(trimmed) || !URL.canParse(trimmed)) return trimmed.toLowerCase();
  const url = new URL(trimmed);
  url.hostname = url.hostname.replace(/^(?:www|m|music)\./i, "").toLowerCase();
  for (const junk of ["t", "si", "feature", "pp"]) url.searchParams.delete(junk);
  const list = url.searchParams.get("list");
  const suffix = list ? `&list=${encodeURIComponent(list)}` : "";
  const path = url.pathname.replace(/\/+$/, "");
  const short = path.match(/^\/(shorts|embed|live|v)\/([\w-]{5,})$/i);
  if (url.hostname === "youtu.be") return `https://youtube.com/watch?v=${path.slice(1)}${suffix}`;
  if (short) return `https://youtube.com/watch?v=${short[2]}${suffix}`;
  if (path === "/watch") {
    const video = url.searchParams.get("v");
    if (video) return `https://youtube.com/watch?v=${encodeURIComponent(video)}${suffix}`;
  }
  return `https://${url.hostname}${path}${url.search}`;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatNumber(format: RawFormat, key: string): number | undefined {
  return finiteNumber(format[key]);
}

function isUsableFormat(value: unknown): value is RawFormat {
  if (!value || typeof value !== "object") return false;
  const format = value as RawFormat;
  return format.playable !== false
    && typeof format.url === "string" && /^https:\/\//i.test(format.url)
    && typeof format.protocol === "string" && /^(?:https?|m3u8_native)$/.test(format.protocol);
}

function isDefaultAudioTrack(format: RawFormat): boolean {
  const track = format.audio_track;
  return Boolean(track && typeof track === "object" && (track as { audio_is_default?: unknown }).audio_is_default === true);
}

function audioRate(format: RawFormat): number {
  return Math.max(formatNumber(format, "abr") ?? 0, formatNumber(format, "tbr") ?? 0);
}

function formatScore(format: RawFormat): number {
  const vcodec = typeof format.vcodec === "string" ? format.vcodec : "none";
  const audioOnly = vcodec === "none" || vcodec === "";
  const opus = typeof format.acodec === "string" && format.acodec.startsWith("opus");
  return (isDefaultAudioTrack(format) ? 4 : 0) + (audioOnly ? 2 : 0) + (opus ? 1 : 0);
}

export function pickAudioFormat(meta: MetaLike): RawFormat | null {
  if (isUsableFormat(meta.best_audio)) return meta.best_audio;
  const formats = (Array.isArray(meta.formats) ? meta.formats : []).filter(isUsableFormat);
  const best = (list: RawFormat[]): RawFormat | null => list.reduce<RawFormat | null>((current, next) => {
    if (!current) return next;
    const diff = formatScore(next) - formatScore(current);
    return diff > 0 || (diff === 0 && audioRate(next) > audioRate(current)) ? next : current;
  }, null);
  const progressive = formats.filter(format => format.protocol !== "m3u8_native");
  return best(progressive) ?? best(formats);
}

export function formatHeaders(format: HeaderSource): Record<string, string> | undefined {
  const raw = format.http_headers;
  if (!raw || typeof raw !== "object") return undefined;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value) headers[key] = value;
  }
  return Object.keys(headers).length ? headers : undefined;
}

function urlExpiresAt(url: string): number | undefined {
  try {
    const value = new URL(url).searchParams.get("expire");
    if (!value) return undefined;
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
  } catch { return undefined; }
}

export function formatExpiresAt(format: ExpirySource): number | undefined {
  const value = finiteNumber(format.expires_at);
  if (value && value > 0) return value * 1000;
  return typeof format.url === "string" ? urlExpiresAt(format.url) : undefined;
}

function pickThumbnail(meta: MetaLike): string | undefined {
  if (typeof meta.thumbnail === "string" && meta.thumbnail) return meta.thumbnail;
  const thumbnails = Array.isArray(meta.thumbnails) ? meta.thumbnails : [];
  const usable = thumbnails.filter((item): item is { url: string } => Boolean(item && typeof item === "object" && typeof (item as { url?: unknown }).url === "string"));
  return usable.at(-1)?.url;
}

type MetaFields = {
  duration: number;
  thumbnail?: string;
  mediaUrl?: string;
  mediaHeaders?: Record<string, string>;
  mediaUrlExpiresAt?: number;
};

function metaFields(meta: MetaLike): MetaFields {
  const duration = finiteNumber(meta.duration) ?? 0;
  const thumbnail = pickThumbnail(meta);
  const format = pickAudioFormat(meta);
  const mediaUrl = format && typeof format.url === "string" && format.url ? format.url : undefined;
  const mediaHeaders = format ? formatHeaders(format) : undefined;
  const mediaUrlExpiresAt = format ? formatExpiresAt(format) ?? Date.now() + MEDIA_URL_TTL_MS : undefined;
  return {
    duration,
    ...(thumbnail ? { thumbnail } : {}),
    ...(mediaUrl ? { mediaUrl } : {}),
    ...(mediaHeaders ? { mediaHeaders } : {}),
    ...(mediaUrlExpiresAt ? { mediaUrlExpiresAt } : {}),
  };
}

function cacheSingleMeta(key: string, meta: CachedMeta): void {
  evictOldest(singleMeta);
  singleMeta.delete(key);
  singleMeta.set(key, meta);
}

function trackFromFullMeta(meta: VideoResult, fallbackQuery: string, requestedBy: string): Track | null {
  const fields = metaFields(meta);
  if (fields.duration > MAX_DURATION_SECONDS) return null;
  const track: Track = {
    query: String(meta.webpage_url ?? fallbackQuery),
    title: String(meta.title ?? fallbackQuery),
    requestedBy,
    ...fields,
  };
  cacheSingleMeta(normalizeTrackKey(track.query), { title: track.title, ...fields });
  return track;
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

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>(resolve => {
    timer = setTimeout(() => resolve(fallback), ms);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

type ResolveRun = { meta: ResolveResult | null; error: BackendFailure | null };

const RESOLVE_RETRY_DELAY_MS = 500;
const RETRYABLE_RESOLVE_CODES = new Set(["TIMEOUT", "NETWORK", "INVALID_RESPONSE"]);

export function isRetryableResolveCode(code: string): boolean {
  return RETRYABLE_RESOLVE_CODES.has(code);
}

function runResolve(query: string, playlistLimit = MAX_PLAYLIST): Promise<ResolveRun> {
  return withResolveSlot(() => withTimeout(
    runResolveOnce(query, playlistLimit),
    RESOLVE_TIMEOUT_MS,
    { meta: null, error: { ok: false, code: "TIMEOUT", message: "resolve timed out" } },
  ));
}

async function runResolveOnce(query: string, playlistLimit: number): Promise<ResolveRun> {
  const target = safeMediaTarget(query);
  if (!target) {
    return { meta: null, error: { ok: false, code: "UNSUPPORTED_URL", message: "unsupported-url" } };
  }
  const limit = Math.max(1, Math.min(MAX_PLAYLIST, Math.trunc(playlistLimit)));
  let result = await resolveMedia(target, backendOptions(limit));
  if (!result.ok && isRetryableResolveCode(result.code)) {
    await delay(RESOLVE_RETRY_DELAY_MS).catch(() => undefined);
    result = await resolveMedia(target, backendOptions(limit));
  }
  return result.ok ? { meta: result.value, error: null } : { meta: null, error: result };
}

export type ResolveErrorKind =
  | "botcheck"
  | "age-restricted"
  | "private"
  | "unavailable"
  | "unsupported-url"
  | "invalid-query"
  | "no-audio"
  | "cookies"
  | "network"
  | "challenge-failed"
  | "backend-unavailable"
  | "too-long"
  | "unknown";

export function mapBackendError(code: string): ResolveErrorKind {
  switch (code) {
    case "BOTCHECK": return "botcheck";
    case "AGE_RESTRICTED": return "age-restricted";
    case "PRIVATE": return "private";
    case "UNAVAILABLE": return "unavailable";
    case "UNSUPPORTED_URL": return "unsupported-url";
    case "INVALID_INPUT": return "invalid-query";
    case "NO_AUDIO": case "FORMAT_NOT_FOUND": return "no-audio";
    case "COOKIES": return "cookies";
    case "TIMEOUT": case "NETWORK": case "HTTP": case "INVALID_RESPONSE": return "network";
    case "CHALLENGE_FAILED": return "challenge-failed";
    case "NATIVE_LOAD": return "backend-unavailable";
    default: return "unknown";
  }
}

const DROP_ON_HYDRATION = new Set([
  "PRIVATE", "UNAVAILABLE", "UNSUPPORTED_URL", "INVALID_INPUT",
  "NO_AUDIO", "FORMAT_NOT_FOUND", "CHALLENGE_FAILED", "TOO_LONG", "UNSAFE_URL",
]);

/** Configuration problems (cookies, native addon) must not silently drain the queue. */
export function shouldDropTrackOnHydration(code: string | undefined): boolean {
  return Boolean(code && DROP_ON_HYDRATION.has(code));
}

type ResolveTracksResult = { tracks: Track[]; error: ResolveErrorKind | null; playlist: boolean };

export async function resolveTracks(query: string, requestedBy: string, playlistLimit = MAX_PLAYLIST): Promise<ResolveTracksResult> {
  const limit = Math.max(1, Math.min(MAX_PLAYLIST, Math.trunc(playlistLimit)));
  const limited = limit < MAX_PLAYLIST;
  const cacheKey = normalizeTrackKey(query);
  const cached = listMeta.get(cacheKey);
  if (cached && Date.now() - cached.at < LIST_META_TTL) {
    const tracks = cached.tracks.map(track => ({ ...track, requestedBy }));
    return { tracks: limited ? tracks.slice(0, limit) : tracks, error: null, playlist: true };
  }
  const { meta, error } = await runResolve(query, limit);
  if (!meta) return { tracks: [], error: mapBackendError(error?.code ?? "UNKNOWN"), playlist: false };
  if (meta._type !== "playlist") {
    const track = trackFromFullMeta(meta, query, requestedBy);
    return track ? { tracks: [track], error: null, playlist: false } : { tracks: [], error: "too-long", playlist: false };
  }
  const entries = meta.entries;
  if (!entries.length) return { tracks: [], error: "unavailable", playlist: true };
  const tracks: Track[] = [];
  let skippedLong = false;
  for (const entry of entries.slice(0, limit)) {
    const raw = entry.url || entry.id;
    if (!raw) continue;
    const duration = typeof entry.duration === "number" && entry.duration > 0 ? entry.duration : undefined;
    if (duration && duration > MAX_DURATION_SECONDS) { skippedLong = true; continue; }
    const thumbnail = entry.thumbnail ?? pickThumbnail(entry);
    const query = entry.id
      ? `https://www.youtube.com/watch?v=${entry.id}`
      : raw.startsWith("http") ? raw : `https://www.youtube.com/watch?v=${raw}`;
    tracks.push({
      query,
      title: String(entry.title ?? raw),
      requestedBy,
      ...(duration ? { duration } : {}),
      ...(thumbnail ? { thumbnail } : {}),
    });
  }
  if (!tracks.length && skippedLong) return { tracks: [], error: "too-long", playlist: true };
  if (!limited && tracks.length) {
    evictOldest(listMeta);
    listMeta.delete(cacheKey);
    listMeta.set(cacheKey, { at: Date.now(), tracks });
  }
  return { tracks, error: null, playlist: true };
}

type HydrateHooks = {
  onTooLong: (guildId: string, track: Track) => void;
  onFailure: (guildId: string, track: Track, code: string) => void;
  onChange: (guildId: string) => void;
};
let hydrateHooks: HydrateHooks | null = null;
export function setHydrateHooks(hooks: HydrateHooks): void { hydrateHooks = hooks; }

export function hydrateTrackMeta(track: Track, guildId: string): void {
  if (track.hydrating) return;
  if (track.duration && track.duration > MAX_DURATION_SECONDS) {
    logger.info("[MUSIC] Трек длиннее лимита — пропускаю", guildId, track.title);
    hydrateHooks?.onTooLong(guildId, track);
    return;
  }
  track.hydrating = true;
  void ensureFreshMediaUrl(track).then(result => {
    track.hydrating = false;
    if (!result.ok) {
      if (result.code === "TOO_LONG") {
        logger.info("[MUSIC] Трек длиннее лимита — пропускаю", guildId, track.title);
        hydrateHooks?.onTooLong(guildId, track);
        return;
      }
      if (shouldDropTrackOnHydration(result.code)) {
        logger.warn("[MUSIC] Трек недоступен — убираю из очереди", guildId, track.title, result.code, redactMediaUrl(result.detail).slice(0, 200));
        hydrateHooks?.onFailure(guildId, track, result.code ?? "UNKNOWN");
      }
      return;
    }
    hydrateHooks?.onChange(guildId);
  }).catch((error: unknown) => {
    track.hydrating = false;
    logger.warn("[MUSIC] Не удалось подготовить трек", guildId, redactMediaUrl(String(error)).slice(0, 200));
  });
}

type MediaSource = { url: string; headers?: Record<string, string> };
type MediaSourceResult = { ok: true; source: MediaSource } | { ok: false; detail: string; code?: string };

const mediaRefreshes = new Map<string, Promise<MediaSourceResult>>();

function freshSource(url: string | undefined, headers: Record<string, string> | undefined, expiresAt: number | undefined): MediaSource | null {
  if (!url || !expiresAt || expiresAt - 60_000 <= Date.now() || !isAllowedStreamUrl(url)) return null;
  return { url, ...(headers ? { headers } : {}) };
}

function setMedia(track: Track, url: string, headers: Record<string, string> | undefined, expiresAt: number): void {
  track.mediaUrl = url;
  if (headers) track.mediaHeaders = headers;
  else delete track.mediaHeaders;
  track.mediaUrlExpiresAt = expiresAt;
}

function applyCachedMeta(track: Track, meta: CachedMeta): void {
  track.title = meta.title;
  if (meta.duration > 0) track.duration = meta.duration;
  if (meta.thumbnail) track.thumbnail = meta.thumbnail;
}

async function refreshMedia(track: Track, key: string): Promise<MediaSourceResult> {
  const target = safeMediaTarget(track.query);
  if (!target) {
    logger.warn("[MUSIC] Отклонён недопустимый адрес трека", normalizeTrackKey(track.query).slice(0, 100));
    return { ok: false, detail: "unsupported-url", code: "UNSUPPORTED_URL" };
  }
  count("music.media_resolve");
  const started = performance.now();
  const result = await withResolveSlot(() => withTimeout(
    resolveAudioMedia(target, audioOptions()),
    MEDIA_RESOLVE_TIMEOUT_MS,
    { ok: false, code: "TIMEOUT", message: "media resolve timed out" } as const,
  ));
  time("music.media_resolve", performance.now() - started);
  if (!result.ok) {
    logger.warn("[MUSIC] Не удалось получить медиа-URL", normalizeTrackKey(track.query).slice(0, 100), result.code, redactMediaUrl(result.message).slice(0, 200));
    return { ok: false, detail: redactMediaUrl(`${result.code}: ${result.message}`).slice(0, 300), code: result.code };
  }
  const audio = result.value;
  const headers = formatHeaders(audio);
  const expiresAt = formatExpiresAt(audio) ?? Date.now() + MEDIA_URL_TTL_MS;
  if (!isAllowedStreamUrl(audio.url)) {
    let host = "invalid";
    try { host = new URL(audio.url).hostname; } catch {  }
    logger.warn("[MUSIC] ytrust вернул URL недопустимого хоста", host);
    return { ok: false, detail: "resolved URL is not an allowed media host", code: "UNSAFE_URL" };
  }
  const duration = typeof audio.duration === "number" && audio.duration > 0 ? audio.duration : 0;
  const thumbnail = typeof audio.thumbnail === "string" && audio.thumbnail ? audio.thumbnail : undefined;
  track.title = audio.title;
  if (duration > 0) track.duration = duration;
  if (thumbnail) track.thumbnail = thumbnail;
  if (duration > MAX_DURATION_SECONDS) {
    return { ok: false, detail: "track is longer than the limit", code: "TOO_LONG" };
  }
  setMedia(track, audio.url, headers, expiresAt);
  cacheSingleMeta(key, {
    title: audio.title,
    duration,
    ...(thumbnail ? { thumbnail } : {}),
    mediaUrl: audio.url,
    ...(headers ? { mediaHeaders: headers } : {}),
    mediaUrlExpiresAt: expiresAt,
  });
  return { ok: true, source: { url: audio.url, ...(headers ? { headers } : {}) } };
}

export async function ensureFreshMediaUrl(track: Track, force = false): Promise<MediaSourceResult> {
  const key = normalizeTrackKey(track.query);
  if (!force) {
    const current = freshSource(track.mediaUrl, track.mediaHeaders, track.mediaUrlExpiresAt);
    if (current) return { ok: true, source: current };
    const cached = singleMeta.get(key);
    const cachedExpiresAt = cached?.mediaUrlExpiresAt;
    const cachedSource = freshSource(cached?.mediaUrl, cached?.mediaHeaders, cachedExpiresAt);
    if (cachedSource && cachedExpiresAt) {
      if (cached) applyCachedMeta(track, cached);
      setMedia(track, cachedSource.url, cachedSource.headers, cachedExpiresAt);
      return { ok: true, source: cachedSource };
    }
  }
  const existing = mediaRefreshes.get(key);
  if (existing) {
    const result = await existing;
    if (result.ok) {
      const meta = singleMeta.get(key);
      if (meta) {
        applyCachedMeta(track, meta);
        if (meta.mediaUrlExpiresAt) setMedia(track, result.source.url, result.source.headers, meta.mediaUrlExpiresAt);
      }
    }
    return result;
  }
  const pending = refreshMedia(track, key).finally(() => { mediaRefreshes.delete(key); });
  mediaRefreshes.set(key, pending);
  return pending;
}
