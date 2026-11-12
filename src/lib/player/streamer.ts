import { spawn, type ChildProcess } from "node:child_process";
import { AudioPlayerStatus, StreamType, createAudioResource, type AudioPlayer } from "@discordjs/voice";
import { logger } from "../logger.ts";
import { count, time } from "../perf.ts";
import { FFMPEG, ensureFreshMediaUrl, isAllowedStreamUrl } from "./resolver.ts";
import type { StreamOutcome, Track } from "./types.ts";

export const ACTIVE_STREAM_LIMIT = 8;
let activeStreams = 0;
export const activeStreamCount = (): number => activeStreams;

const STALL_MS = 30_000;
const RESOLVE_TIMEOUT_MS = 30_000;

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
  let settled = false, cancelled = false, finished = false;
  let ffmpeg: ChildProcess | null = null;
  let stallTimer: NodeJS.Timeout | null = null;
  const { promise, resolve: resolveOutcome } = Promise.withResolvers<StreamOutcome>();
  const settle = (value: StreamOutcome) => { if (!settled) { settled = true; resolveOutcome(value); } };

  activeStreams++;
  const finish = () => {
    if (finished) return;
    finished = true;
    activeStreams--;
    if (stallTimer) { clearInterval(stallTimer); stallTimer = null; }
    try { ffmpeg?.kill("SIGKILL"); } catch {  }
  };

  void (async () => {
    let guard: NodeJS.Timeout | null = null;
    const timeout = new Promise<null>(resolve => {
      guard = setTimeout(() => resolve(null), RESOLVE_TIMEOUT_MS);
      guard.unref();
    });
    const resolved = await Promise.race([ensureFreshMediaUrl(track, opts.forceRefresh === true), timeout]).catch(() => null);
    if (guard) clearTimeout(guard);
    if (cancelled || finished) return;
    if (!resolved) {
      settle({ kind: "source-error", detail: "резолв медиа-URL не уложился в 30 c", code: "RESOLVE_TIMEOUT" });
      finish();
      return;
    }
    if (!resolved.ok) {
      settle({ kind: "source-error", detail: resolved.detail.slice(0, 300), ...(resolved.code ? { code: resolved.code } : {}) });
      finish();
      return;
    }
    const source = resolved.source;
    if (!isAllowedStreamUrl(source.url)) {
      settle({ kind: "source-error", detail: "resolved URL is not an allowed media host", code: "UNSAFE_URL" });
      finish();
      return;
    }
    try { opts.onMetadata?.(); } catch {  }

    let proc: ChildProcess;
    try {
      proc = spawn(FFMPEG, ffmpegArgs(source.url, offset, source.headers),
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      logger.warn("[MUSIC] ffmpeg не удалось запустить", String(error).slice(0, 200));
      settle({ kind: "source-error", detail: "ffmpeg spawn failed" });
      finish();
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
    stdout.on("data", () => { lastOutputAt = performance.now(); });
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
    stdout.once("data", () => {
      if (gotFirstPacket) return;
      gotFirstPacket = true;
      time("music.stream_ttfb", performance.now() - spawnAt);
    });

    proc.once("error", error => {
      logger.warn("[MUSIC] ffmpeg не удалось запустить", String(error).slice(0, 200));
      settle({ kind: "source-error", detail: "ffmpeg spawn failed" });
      finish();
    });
    proc.once("close", code => {
      if (cancelled) { finish(); return; }
      if (code !== null && code !== 0) {
        logger.warn("[MUSIC] ffmpeg завершился аварийно", ffmpegErrTail.trim(), `код ${code}`);
        settle({ kind: "source-error", detail: (ffmpegErrTail.trim() || `код ${code}`).slice(-300) });
      } else {
        settle({ kind: "eof" });
      }
      finish();
    });
    try {
      player.play(createAudioResource(stdout, { inputType: StreamType.OggOpus }));
    } catch (error) {
      settle({ kind: "source-error", detail: String(error).slice(0, 200) });
      finish();
    }
  })();

  return { outcome: promise, cancel: () => { cancelled = true; settle({ kind: "external" }); finish(); } };
}
