import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { AudioPlayerStatus, StreamType, createAudioResource, type AudioPlayer } from "@discordjs/voice";
import { logger } from "../../bot/utils/logger.ts";
import { count, time } from "../../bot/perf.ts";
import { FFMPEG, YT_DLP, isAllowedMediaUrl, ytDlpArgs } from "./resolver.ts";
import type { StreamOutcome, Track } from "./types.ts";

/** Прямой URL принимается только от доверенных хостов (googlevideo CDN). */
function isAllowedStreamUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "googlevideo.com" || host.endsWith(".googlevideo.com") || isAllowedMediaUrl(url);
  } catch { return false; }
}

export const ACTIVE_STREAM_LIMIT = 8; // глобальный потолок процессов ffmpeg+yt-dlp
let activeStreams = 0;
export const activeStreamCount = (): number => activeStreams;

const STALL_MS = 30_000;

export type StreamHandle = {
  outcome: Promise<StreamOutcome>;
  /** SIGKILL пары процессов; исход будет external, если ещё не завершён.
   *  Вызывать ДО остановки плеера — тогда разборка не выглядит аварией. */
  cancel: () => void;
};

/** Аргументы ffmpeg. Резюм: прямой URL — быстрый входной -ss (HTTP Range);
 *  для трубы seek делает сам yt-dlp (--download-sections), тут offset не нужен. */
export function ffmpegArgs(mediaUrl: string | null, offsetSec: number): string[] {
  const input = mediaUrl
    ? (offsetSec > 0 ? ["-thread_queue_size", "1024", "-ss", String(offsetSec), "-i", mediaUrl] : ["-thread_queue_size", "1024", "-i", mediaUrl])
    : ["-thread_queue_size", "1024", "-i", "pipe:0"];
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-fflags", "nobuffer", "-analyzeduration", "0", "-probesize", "512k",
    ...input,
    "-map", "0:a:0", "-vn", "-threads", "1",
    "-ac", "2", "-ar", "48000",
    "-c:a", "libopus", "-b:a", "96k", "-application", "audio",
    "-f", "ogg", "pipe:1",
  ];
}

/** Аргументы yt-dlp; с позиции — серверный Range-seek (--download-sections). */
export function ytdlpArgsFor(offsetSec: number, query: string): string[] {
  return ytDlpArgs(
    ...(offsetSec > 0 ? ["--download-sections", `*${Math.floor(offsetSec)}-inf`] : []),
    "--no-playlist", "-f", "bestaudio[acodec^=opus]/bestaudio/best", "-o", "-", "--", query,
  );
}

export function startAudioStream(opts: { track: Track; player: AudioPlayer; offsetSec?: number }): StreamHandle {
  const { track, player } = opts;
  const offset = opts.offsetSec && opts.offsetSec > 0 ? Math.floor(opts.offsetSec) : 0;
  let settled = false, cancelled = false, finished = false;
  let resolveOutcome!: (o: StreamOutcome) => void;
  const settle = (value: StreamOutcome) => { if (!settled) { settled = true; resolveOutcome(value); } };
  const promise = new Promise<StreamOutcome>(resolve => { resolveOutcome = resolve; });

  // Прямой URL живёт ограниченное время: протух или не выдался — через yt-dlp.
  const viaExtractor = !(track.mediaUrl && track.mediaUrlExpiresAt && Date.now() < track.mediaUrlExpiresAt && isAllowedStreamUrl(track.mediaUrl));
  count(viaExtractor ? "music.stream_extractor" : "music.stream_direct");
  let ytdlpErrTail = "";
  const ytdlp = viaExtractor
    ? spawn(YT_DLP, ytdlpArgsFor(offset, track.query), { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    : null;
  ytdlp?.stderr?.on("data", (chunk: Buffer) => { ytdlpErrTail = `${ytdlpErrTail}${chunk}`.slice(-400); });
  const ffmpeg = spawn(FFMPEG, ffmpegArgs(viaExtractor ? null : track.mediaUrl!, offset),
    { windowsHide: true, stdio: viaExtractor ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"] });
  let ffmpegErrTail = "";
  ffmpeg.stderr?.on("data", (chunk: Buffer) => { ffmpegErrTail = `${ffmpegErrTail}${chunk}`.slice(-400); });

  activeStreams++;
  const finish = () => {
    if (finished) return;
    finished = true;
    activeStreams--;
    clearInterval(stallTimer);
    try { ytdlp?.kill("SIGKILL"); } catch { /* уже вышел */ }
    try { ffmpeg.kill("SIGKILL"); } catch { /* уже вышел */ }
  };

  let gotFirstPacket = false;
  let lastOutputAt = performance.now();
  const spawnAt = performance.now();
  // Пассивный слушатель поверх потребления ресурсом: только метки времени.
  ffmpeg.stdout!.on("data", () => { lastOutputAt = performance.now(); });
  const stallTimer = setInterval(() => {
    if (!gotFirstPacket) {
      if (performance.now() - spawnAt >= STALL_MS) { settle({ kind: "stall", phase: "start" }); finish(); }
      return;
    }
    const status = player.state.status;
    // Пауза и межтрековый зазор — осознанное отсутствие потока, не стиль.
    if (status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.Idle) { lastOutputAt = performance.now(); return; }
    if (performance.now() - lastOutputAt >= STALL_MS) { settle({ kind: "stall", phase: "middle" }); finish(); }
  }, 5_000);
  stallTimer.unref?.();
  ffmpeg.stdout!.once("data", () => {
    if (gotFirstPacket) return;
    gotFirstPacket = true;
    time("music.stream_ttfb", performance.now() - spawnAt);
  });

  if (ytdlp) {
    // pipeline вместо pipe: EPIPE при смерти одной стороны не крашит процесс.
    void pipeline(ytdlp.stdout!, ffmpeg.stdin!).catch(() => { /* разборка в close */ });
    // Спавн-фейл (нет бинаря, права) иначе падал бы необработанной ошибкой.
    ytdlp.once("error", error => { logger.warn("[MUSIC] yt-dlp не удалось запустить", String(error).slice(0, 200)); settle({ kind: "source-error", detail: "yt-dlp spawn failed" }); finish(); });
    ytdlp.once("close", code => {
      // Ненулевой код скачивания — мёртвый источник; EOF дождётся close ffmpeg.
      if (!finished && !cancelled && code !== 0 && code !== null)
        settle({ kind: "source-error", detail: (ytdlpErrTail.trim() || `код ${code}`).slice(-300) });
    });
  }
  ffmpeg.once("error", () => { settle({ kind: "source-error", detail: "ffmpeg spawn failed" }); finish(); });
  ffmpeg.once("close", code => {
    if (cancelled) return finish(); // external уже выставлен cancel()
    if (code !== null && code !== 0) {
      logger.warn("[MUSIC] ffmpeg завершился аварийно", (ffmpegErrTail || ytdlpErrTail).trim(), `код ${code}`);
      settle({ kind: "source-error", detail: (ffmpegErrTail.trim() || `код ${code}`).slice(-300) });
    } else {
      settle({ kind: "eof" }); // наигранную позицию знает сессия (playbackDuration)
    }
    finish();
  });
  try {
    player.play(createAudioResource(ffmpeg.stdout!, { inputType: StreamType.OggOpus }));
  } catch (error) {
    // Отсутствие libopus и подобные сбои не вылетают наружу.
    settle({ kind: "source-error", detail: String(error).slice(0, 200) });
    finish();
  }
  return { outcome: promise, cancel: () => { cancelled = true; settle({ kind: "external" }); finish(); } };
}
