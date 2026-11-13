import type { AudioResult, ResolveOptions, ResolveResult } from "ytrust";
import { logger } from "../logger.ts";

type YtrustModule = typeof import("ytrust");

export type BackendFailure = { ok: false; code: string; message: string };
type BackendResult<T> = { ok: true; value: T } | BackendFailure;

const BACKEND_RETRY_MS = 60_000;
const DEFAULT_TIMEOUT_SEC = 15;

let backendPromise: Promise<YtrustModule> | null = null;
let probePromise: Promise<boolean> | null = null;
let probeRetryAt = 0;
let reportedVersion = false;
let lastProbeError = "";

/** Load the native addon lazily so a music failure cannot take down the bot. */
function loadBackend(): Promise<YtrustModule> {
  backendPromise ??= import("ytrust").catch(error => {
    backendPromise = null;
    throw error;
  });
  return backendPromise;
}

function normalizeFailure(error: unknown): BackendFailure {
  const message = error instanceof Error ? error.message : String(error);
  const rawCode = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  const code = typeof rawCode === "string" && rawCode ? rawCode : "UNKNOWN";
  return { ok: false, code, message };
}

function envTimeout(): number {
  const value = Number(process.env.YTRUST_TIMEOUT);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_SEC;
  return Math.max(1, Math.trunc(value));
}

function baseOptions(): ResolveOptions {
  const options: ResolveOptions = { timeout: envTimeout() };
  const cookies = process.env.YTRUST_COOKIES?.trim();
  if (cookies) options.cookiesPath = cookies;
  const browser = process.env.YTRUST_COOKIES_FROM_BROWSER?.trim();
  if (browser) options.cookiesFromBrowser = browser;
  const proxy = process.env.YTRUST_PROXY?.trim();
  if (proxy) options.proxy = proxy;
  return options;
}

export function backendOptions(playlistLimit?: number): ResolveOptions {
  const options = baseOptions();
  if (playlistLimit !== undefined) {
    const limit = Math.max(1, Math.trunc(playlistLimit));
    options.playlistLimit = limit;
    options.playlistItems = `1-${limit}`;
  }
  return options;
}

/** Single-track audio resolution must never expand an attached playlist. */
export function audioOptions(): ResolveOptions {
  const options = baseOptions();
  options.noPlaylist = true;
  // ytrust waits out YouTube's cold CDN edge before returning the URL, so
  // ffmpeg starts against a playable stream instead of reconnecting on 403.
  options.ensurePlayable = true;
  return options;
}

export function probeMusicBackend(): Promise<boolean> {
  if (probePromise) return probePromise;
  if (Date.now() < probeRetryAt) return Promise.resolve(false);
  const pending = loadBackend()
    .then(module => {
      const version = module.version();
      if (!reportedVersion) {
        reportedVersion = true;
        logger.info("[MUSIC] ytrust", version);
      }
      lastProbeError = "";
      return true;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastProbeError) {
        lastProbeError = message;
        logger.warn("[MUSIC] ytrust недоступен", message.slice(0, 300));
      }
      return false;
    });
  probePromise = pending;
  void pending.then(ok => {
    if (ok) return;
    probePromise = null;
    probeRetryAt = Date.now() + BACKEND_RETRY_MS;
  });
  return pending;
}

export async function resolveMedia(input: string, options: ResolveOptions = backendOptions()): Promise<BackendResult<ResolveResult>> {
  try {
    const module = await loadBackend();
    return { ok: true, value: await module.resolve(input, options) };
  } catch (error) {
    return normalizeFailure(error);
  }
}

export async function resolveAudioMedia(input: string, options: ResolveOptions = audioOptions()): Promise<BackendResult<AudioResult>> {
  try {
    const module = await loadBackend();
    return { ok: true, value: await module.resolveAudio(input, options) };
  } catch (error) {
    return normalizeFailure(error);
  }
}
