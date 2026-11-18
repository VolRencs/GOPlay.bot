import { spawn, type ChildProcess } from "node:child_process";
import { AudioPlayerStatus, StreamType, createAudioResource, type AudioPlayer } from "@discordjs/voice";
import { logger } from "../logger.ts";
import { count, time } from "../perf.ts";
import { FFMPEG, MEDIA_RESOLVE_TIMEOUT_MS, ensureFreshMediaUrl, isAllowedStreamUrl, redactMediaUrl } from "./resolver.ts";
import type { StreamOutcome, Track } from "./types.ts";

export const ACTIVE_STREAM_LIMIT = 8;
let activeStreams = 0;
export const activeStreamCount = (): number => activeStreams;

const STALL_MS = 30_000;
const RESOLVE_TIMEOUT_MS = MEDIA_RESOLVE_TIMEOUT_MS + 5_000;

export type StreamHandle = {
  outcome: Promise<StreamOutcome>;
  cancel: () => void;
};

export function ffmpegArgs(mediaUrl: string, offsetSec: number, headers?: Record<string, string>): string[] {
  const userAgent = headers?.["User-Agent"] ?? headers?.["user-agent"];
  const headerLines = Object.entries(headers ?? {})
    .filter(([key]) => key.toLowerCase() !== "user-agent")
    .map(([key, value]) => `${key}: ${value}\r\n`)
    .join("");
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-fflags", "nobuffer", "-analyzeduration", "0", "-probesize", "512k",
    "-thread_queue_size", "1024",
    ...(offsetSec > 0 ? ["-ss", String(offsetSec)] : []),
    ...(userAgent ? ["-user_agent", userAgent] : []),
    ...(headerLines ? ["-headers", headerLines] : []),
    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
    // A fresh googlevideo URL may hit a cold CDN edge that answers 403 for a
    // few seconds. Reconnect re-requests the original URL instead of failing.
    "-reconnect_on_http_error", "403,408,410,425,429,500,502,503,504",
    "-i", mediaUrl,
    "-map", "0:a:0", "-vn", "-threads", "1",
    "-ac", "2", "-ar", "48000",
    "-c:a", "libopus", "-b:a", "96k", "-application", "audio",
    "-f", "ogg", "pipe:1",
  ];
}

type StartOptions = {
  track: Track;
  player: AudioPlayer;
  offsetSec?: number;
  forceRefresh?: boolean;
  onMetadata?: () => void;
};

export function startAudioStream(opts: StartOptions): StreamHandle {
  const { track, player } = opts;
  const offset = opts.offsetSec && opts.offsetSec > 0 ? Math.floor(opts.offsetSec) : 0;
  let finished = false;
  let ffmpeg: ChildProcess | null = null;
  let stallTimer: NodeJS.Timeout | null = null;
  const { promise, resolve: settle } = Promise.withResolvers<StreamOutcome>();

  activeStreams++;
  const finish = () => {
    if (finished) return;
    finished = true;
    activeStreams--;
    if (stallTimer) { clearInterval(stallTimer); stallTimer = null; }
    try { ffmpeg?.kill("SIGKILL"); } catch {  }
  };
  const fail = (detail: string, code?: string) => {
    settle({ kind: "source-error", detail, ...(code ? { code } : {}) });
    finish();
  };

  void (async () => {
    let guard: NodeJS.Timeout | null = null;
    const timeout = new Promise<null>(resolve => {
      guard = setTimeout(() => resolve(null), RESOLVE_TIMEOUT_MS);
      guard.unref();
    });
    const resolved = await Promise.race([ensureFreshMediaUrl(track, opts.forceRefresh === true), timeout]).catch(() => null);
    if (guard) clearTimeout(guard);
    if (finished) return;
    if (!resolved) {
      fail(`резолв медиа-URL не уложился в ${Math.round(RESOLVE_TIMEOUT_MS / 1000)} c`, "RESOLVE_TIMEOUT");
      return;
    }
    if (!resolved.ok) {
      fail(resolved.detail.slice(0, 300), resolved.code);
      return;
    }
    const source = resolved.source;
    if (!isAllowedStreamUrl(source.url)) {
      fail("resolved URL is not an allowed media host", "UNSAFE_URL");
      return;
    }
    try { opts.onMetadata?.(); } catch {  }

    let proc: ChildProcess;
    try {
      proc = spawn(FFMPEG, ffmpegArgs(source.url, offset, source.headers),
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      logger.warn("[MUSIC] ffmpeg не удалось запустить", String(error).slice(0, 200));
      fail("ffmpeg spawn failed");
      return;
    }
    ffmpeg = proc;
    count("music.stream_direct");

    let ffmpegErrTail = "";
    proc.stderr?.on("data", (chunk: Buffer) => { ffmpegErrTail = `${ffmpegErrTail}${chunk}`.slice(-400); });

    let gotFirstPacket = false;
    let lastOutputAt = performance.now();
    const spawnAt = performance.now();
    const stdout = proc.stdout!;
    stdout.on("data", () => {
      lastOutputAt = performance.now();
      if (gotFirstPacket) return;
      gotFirstPacket = true;
      time("music.stream_ttfb", performance.now() - spawnAt);
    });
    stallTimer = setInterval(() => {
      if (!gotFirstPacket) {
        if (performance.now() - spawnAt >= STALL_MS) { settle({ kind: "stall", phase: "start" }); finish(); }
        return;
      }
      const status = player.state.status;
      if (status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.Idle) { lastOutputAt = performance.now(); return; }
      if (performance.now() - lastOutputAt >= STALL_MS) { settle({ kind: "stall", phase: "middle" }); finish(); }
    }, 5_000);
    stallTimer.unref();

    proc.once("error", error => {
      logger.warn("[MUSIC] ffmpeg не удалось запустить", String(error).slice(0, 200));
      fail("ffmpeg spawn failed");
    });
    proc.once("close", code => {
      if (finished) return;
      if (code !== null && code !== 0) {
        const detail = redactMediaUrl(ffmpegErrTail.trim() || `код ${code}`);
        logger.warn("[MUSIC] ffmpeg завершился аварийно", detail, `код ${code}`);
        settle({ kind: "source-error", detail: detail.slice(-300) });
      } else {
        settle({ kind: "eof" });
      }
      finish();
    });
    try {
      player.play(createAudioResource(stdout, { inputType: StreamType.OggOpus }));
    } catch (error) {
      fail(redactMediaUrl(String(error)).slice(0, 200));
    }
  })().catch((error: unknown) => {
    logger.warn("[MUSIC] Ошибка запуска стрима", redactMediaUrl(String(error)).slice(0, 200));
    fail("stream setup failed");
  });

  return { outcome: promise, cancel: () => { settle({ kind: "external" }); finish(); } };
}
