import type { AudioResult, ResolveOptions, ResolveResult } from "ytrust";

type YtrustModule = typeof import("ytrust");

export type BackendFailure = { ok: false; code: string; message: string };
export type BackendResult<T> = { ok: true; value: T } | BackendFailure;

const BACKEND_RETRY_MS = 60_000;
const DEFAULT_TIMEOUT_SEC = 15;

let backendPromise: Promise<YtrustModule> | null = null;
let probePromise: Promise<boolean> | null = null;
let probeRetryAt = 0;

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
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : DEFAULT_TIMEOUT_SEC;
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

export function probeMusicBackend(): Promise<boolean> {
  if (probePromise) return probePromise;
  if (Date.now() < probeRetryAt) return Promise.resolve(false);
  const pending = loadBackend()
    .then(module => {
      try { module.version(); return true; } catch { return false; }
    })
    .catch(() => false);
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

export async function resolveAudioMedia(input: string, options: ResolveOptions = backendOptions()): Promise<BackendResult<AudioResult>> {
  try {
    const module = await loadBackend();
    return { ok: true, value: await module.resolveAudio(input, options) };
  } catch (error) {
    return normalizeFailure(error);
  }
}
