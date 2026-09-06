// Сессия гильдии: соединение, плеер, очередь и политика судьбы трека по
// исходам стримера. Все переходы через handleIdle — двойных advance нет.

import { type Guild } from "discord.js";
import { AudioPlayerStatus, NoSubscriberBehavior, VoiceConnectionStatus, createAudioPlayer, entersState, joinVoiceChannel, type VoiceConnection } from "@discordjs/voice";
import { logger } from "../../bot/utils/logger.ts";
import { count } from "../../bot/perf.ts";
import { ACTIVE_STREAM_LIMIT, activeStreamCount, startAudioStream, type StreamHandle } from "./streamer.ts";
import { isAllowedMediaUrl, setHydrateHooks } from "./resolver.ts";
import { moveWithinList, MAX_QUEUE, MAX_DURATION_SECONDS, isNaturalEnd, nextLoopMode, partitionByIndices, shuffleWithin, type LoopMode, type StreamOutcome, type Track } from "./types.ts";
import { musicSettingsFor } from "../music-settings.ts";

type Session = {
  guildId: string;
  textChannelId: string;
  connection: VoiceConnection;
  player: ReturnType<typeof createAudioPlayer>;
  current: Track | null;
  queue: Track[];
  loopMode: LoopMode;
  idleSince: number | null;
  activityTimer: NodeJS.Timeout | null;
  skipFlag: boolean; // явный /skip или too-long: Idle двигает очередь без лупа и резюма
  generation: number; // растёт на каждом новом стриме; инвалидирует устаревшие решения
  handle: StreamHandle | null;
  failedStarts: number;
  resumesLeft: number;
  lastResumeSec: number;
  restarted: boolean;
};

const sessions = new Map<string, Session>();

/** Сколько голов очереди показывает embed панели. */
const PANEL_PREVIEW_SIZE = 5;

let onMusicChange: ((guildId: string) => void) | null = null;
export function setOnMusicChange(fn: (guildId: string) => void): void { onMusicChange = fn; }
function notify(guildId: string): void { try { onMusicChange?.(guildId); } catch { /* панель не критична */ } }

let onTrackStart: ((guildId: string, requestedBy: string) => void) | null = null;
/** Новый трек пошел (не резюм): бот-слой может перевести соединение к каналу автора. */
export function setOnTrackStart(fn: (guildId: string, requestedBy: string) => void): void { onTrackStart = fn; }

// считаем людей > 0 — консервативно, чтобы случайно не убивать сессии.
let playerEnvironment: { humansInBotChannel: (guildId: string) => number } | null = null;
export function setPlayerEnvironment(env: { humansInBotChannel: (guildId: string) => number }): void { playerEnvironment = env; }

// Политика «трек длиннее лимита» здесь; резолвер только сообщает.
setHydrateHooks({
  isCurrent: track => [...sessions.values()].some(s => s.current === track),
  onTooLong: (guildId, track) => {
    if (sessions.get(guildId)?.current !== track) return;
    skipCurrent(guildId);
  },
  onChange: notify,
});

export const getSessionTextChannelId = (guildId: string): string | null => sessions.get(guildId)?.textChannelId ?? null;
export const hasCurrent = (guildId: string): boolean => sessions.get(guildId)?.current != null;
export const queueSizeOf = (guildId: string): number => sessions.get(guildId)?.queue.length ?? 0;

export function getQueueSnapshot(guildId: string): { current: Track | null; queue: Track[] } {
  const s = sessions.get(guildId);
  return { current: s?.current ?? null, queue: [...s?.queue ?? []] };
}

/** Состояние для панели управления. */
export function playbackStateOf(guildId: string) {
  const s = sessions.get(guildId);
  if (!s?.current) return null;
  return {
    current: s.current, queuePreview: s.queue.slice(0, PANEL_PREVIEW_SIZE), queueLength: s.queue.length,
    paused: s.player.state.status === AudioPlayerStatus.Paused,
    loopMode: s.loopMode,
  };
}

function refreshActivityTimer(s: Session): void {
  disarmActivityTimer(s);
  const seconds = musicSettingsFor(s.guildId).leave_after_seconds;
  const ms = seconds > 0 ? Math.max(30, seconds) * 1000 : 0;
  if (!ms) { s.idleSince = null; return; }
  const humans = playerEnvironment?.humansInBotChannel(s.guildId) ?? 1;
  const paused = s.player.state.status === AudioPlayerStatus.Paused;
  const drained = s.current === null && s.queue.length === 0;
  if (humans > 0 && !paused && !drained) { s.idleSince = null; return; }
  if (s.idleSince === null) s.idleSince = Date.now();
  const remain = s.idleSince + ms - Date.now();
  if (remain <= 0) { destroySession(s.guildId); return; }
  s.activityTimer = setTimeout(() => {
    logger.info("[MUSIC] Бездействие (нет слушателей / тишина / пауза) — покидаю канал", s.guildId);
    destroySession(s.guildId);
  }, remain);
}
function disarmActivityTimer(s: Session): void {
  if (s.activityTimer) { clearTimeout(s.activityTimer); s.activityTimer = null; }
}

/** Внешнее событие присутствия: пересчитать условие бездействия живой сессии. */
export function refreshSessionActivity(guildId: string): void {
  const s = sessions.get(guildId);
  if (s) refreshActivityTimer(s);
}

export function connectToVoice(guild: Guild, voiceChannelId: string, textChannelId: string): void {
  const guildId = guild.id;
  if (sessions.has(guildId)) return;
  const connection = joinVoiceChannel({ channelId: voiceChannelId, guildId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true });
  // Терпимость к сухому буферу 250×20мс=5c вместо дефолтных 100мс: дефолт
  // молча скипал треки при троттлинге источника.
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play, maxMissedFrames: 250 } });
  connection.subscribe(player);
  const session: Session = {
    guildId, textChannelId, connection, player,
    current: null, queue: [], loopMode: "off",
    idleSince: null,
    activityTimer: null,
    skipFlag: false, generation: 0, handle: null,
    failedStarts: 0, resumesLeft: 0, lastResumeSec: 0, restarted: false,
  };
  sessions.set(guildId, session);

  Promise.any([
    entersState(connection, VoiceConnectionStatus.Connecting, 10_000),
    entersState(connection, VoiceConnectionStatus.Signalling, 10_000),
  ]).catch((error: unknown) => {
    logger.warn("[MUSIC] Не удалось установить голосовое соединение", guildId, error);
    destroySession(guildId);
  });
  // Официальный рецепт Disconnected (кик, 4014): 5 c на самовосстановление.
  void entersState(connection, VoiceConnectionStatus.Disconnected, 2 ** 31 - 1).then(() => {
    Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
      entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
    ]).catch(() => destroySession(guildId));
  }).catch(() => { /* соединение уничтожено до Disconnected */ });

  player.on(AudioPlayerStatus.Playing, () => {
    const s = sessions.get(guildId);
    if (!s) return;
    refreshActivityTimer(s);
    s.failedStarts = 0;
  });
  player.on("error", error => {
    if (sessions.get(guildId)) logger.info("[MUSIC] Ошибка аудиопотока", guildId, error.message);
  });
  player.on(AudioPlayerStatus.Idle, (_old, next) => {
    if (!sessions.get(guildId)) return; // сессия уничтожена/пересоздана
    void handleIdle(session, (_old as { playbackDuration?: number }).playbackDuration ?? (next as { resource?: { playbackDuration?: number } }).resource?.playbackDuration ?? 0);
  });
  refreshActivityTimer(session);
}

function destroySession(guildId: string): void {
  const s = sessions.get(guildId);
  if (!s) return;
  sessions.delete(guildId);
  disarmActivityTimer(s);
  try { s.handle?.cancel(); } catch { /* уже мертв */ }
  try { s.player.stop(true); } catch { /* уже остановлен */ }
  try { s.connection.destroy(); } catch { /* уже уничтожено */ }
  notify(guildId);
}

export function stopAndLeave(guildId: string): void { destroySession(guildId); }
export function destroyAllSessions(): void { for (const id of [...sessions.keys()]) destroySession(id); }

export function enqueueTrack(guildId: string, track: Track): boolean {
  const s = sessions.get(guildId);
  if (!s || s.queue.length >= MAX_QUEUE) return false;
  s.queue.push(track);
  notify(guildId);
  return true;
}

export function shuffleQueue(guildId: string): void {
  const s = sessions.get(guildId);
  if (!s) return;
  shuffleWithin(s.queue);
  notify(guildId);
}

export function removeQueueTracks(guildId: string, indices: number[]): Track[] {
  const s = sessions.get(guildId);
  if (!s) return [];
  const [kept, gone] = partitionByIndices(s.queue, indices);
  if (!gone.length) return [];
  s.queue = kept;
  notify(guildId);
  return gone;
}

export function moveQueueTrack(guildId: string, from: number, to: number): number {
  const s = sessions.get(guildId);
  if (!s) return -1;
  const at = moveWithinList(s.queue, from, to);
  if (at >= 0) notify(guildId);
  return at;
}

export function togglePause(guildId: string): void {
  const s = sessions.get(guildId);
  if (!s?.current) return;
  if (s.player.state.status === AudioPlayerStatus.Paused) {
    s.player.unpause();
    refreshActivityTimer(s);
  } else {
    s.player.pause();
    refreshActivityTimer(s);
  }
  notify(guildId);
}

export function cycleLoop(guildId: string): void {
  const s = sessions.get(guildId);
  if (!s) return;
  s.loopMode = nextLoopMode(s.loopMode);
  notify(guildId);
}

export function skipCurrent(guildId: string): void {
  const s = sessions.get(guildId);
  if (!s?.current) return;
  s.skipFlag = true;
  // Стрим рвём ДО остановки плеера: SIGKILL даёт чистый external, а не ложный
  // source-error от разрушения демуксера.
  s.handle?.cancel();
  if (s.player.state.status === AudioPlayerStatus.Paused) s.player.unpause();
  refreshActivityTimer(s);
  s.player.stop();
}

export function playNext(guildId: string): Track | null {
  const s = sessions.get(guildId);
  if (!s) return null;
  const next = s.queue.shift() ?? null;
  s.current = next;
  s.generation++;
  s.skipFlag = false;
  s.resumesLeft = RESUME_BUDGET;
  s.lastResumeSec = 0;
  s.restarted = false;
  refreshActivityTimer(s);
  notify(guildId);
  if (!next) return null;
  launch(s, next, 0);
  return next;
}

const RESUME_BUDGET = 2;
const RESUME_MIN_PROGRESS = 5;
/** Сколько ждём исход стримера после Idle, прежде чем решать без него. */
const OUTCOME_RACE_MS = 250;

function launch(s: Session, track: Track, offsetSec: number): void {
  if (track.duration && track.duration > MAX_DURATION_SECONDS) {
    logger.warn("[MUSIC] Трек длиннее лимита — пропускаю", s.guildId, track.title);
    advance(s, null);
    return;
  }
  // Новый трек (не резюм с позиции): бот-слой решает, переезжать ли к автору.
  if (offsetSec === 0) { try { onTrackStart?.(s.guildId, track.requestedBy); } catch { /* переход не критичен */ } }
  if (/^https?:\/\//i.test(track.query) && !isAllowedMediaUrl(track.query)) {
    logger.warn("[MUSIC] Отклонена ссылка на недопустимый хост", s.guildId);
    failForward(s, "unsupported-url");
    return;
  }
  if (activeStreamCount() >= ACTIVE_STREAM_LIMIT) {
    count("music.limit_wait"); // слот занят другой гильдией — ждём, не выметая очередь
    const gen = s.generation;
    setTimeout(() => {
      // Skip в окне ожидания слота отменяет запуск: player.stop() при Idle
      // не порождает Idle-события, поэтому флаг проверяем здесь явно.
      if (!s.skipFlag && sessions.get(s.guildId) === s && s.generation === gen && s.current === track && s.player.state.status !== AudioPlayerStatus.Playing) launch(s, track, offsetSec);
    }, 1_000).unref?.();
    return;
  }
  s.handle?.cancel();
  s.handle = startAudioStream({ track, player: s.player, offsetSec });
}

async function handleIdle(s: Session, playedMs: number): Promise<void> {
  const finished = s.current;
  const playedSec = s.lastResumeSec + playedMs / 1000;
  // Исход обычно успевает придти вместе с close процессов; кап страховочный.
  const outcome: StreamOutcome | null = s.handle
    ? await Promise.race([s.handle.outcome, new Promise<null>(r => setTimeout(r, OUTCOME_RACE_MS))])
    : null;
  if (sessions.get(s.guildId) !== s || s.current !== finished) return;
  if (s.skipFlag) { s.skipFlag = false; advance(s, finished); return; }

  const naturalEnd = !outcome || (outcome.kind === "eof" && isNaturalEnd(playedSec, finished?.duration));
  if (finished && s.loopMode === "track" && naturalEnd) { launch(s, finished, 0); return; }
  if (finished && outcome && outcome.kind !== "external" && !naturalEnd) { tryResumeOrForward(s, finished, playedSec, outcome); return; }
  advance(s, finished);
}

function tryResumeOrForward(s: Session, track: Track, playedSec: number, outcome: StreamOutcome): void {
  // Резюм возможен при прогрессе между попытками либо в самом начале трека.
  if (s.resumesLeft > 0 && (playedSec >= s.lastResumeSec + RESUME_MIN_PROGRESS || playedSec < RESUME_MIN_PROGRESS)) {
    s.resumesLeft--;
    s.lastResumeSec = Math.max(s.lastResumeSec, playedSec);
    count("music.resume");
    logger.warn("[MUSIC] Стрим прервался рано — резюм с позиции", s.guildId, track.title, `${Math.floor(playedSec)}c`, outcome.kind, "detail" in outcome ? outcome.detail : "");
    launch(s, track, playedSec);
    return;
  }
  if (!s.restarted) {
    s.restarted = true;
    s.resumesLeft = RESUME_BUDGET;
    s.lastResumeSec = 0;
    launch(s, track, 0);
    return;
  }
  failForward(s, outcome.kind === "source-error" ? outcome.detail || "источник умер"
    : outcome.kind === "stall" ? (outcome.phase === "start" ? "источник не начал отдавать данные за 30 c" : "поток замер при активном плеере")
    : outcome.kind);
}

function failForward(s: Session, reason: string): void {
  const track = s.current;
  s.failedStarts++;
  count("music.fail_forward");
  if (s.failedStarts >= 3) {
    logger.error("[MUSIC] Три трека подряд не смогли играть — останавливаю плеер", s.guildId, reason);
    destroySession(s.guildId);
    return;
  }
  logger.warn("[MUSIC] Трек не смог играть — переключаюсь", s.guildId, track?.title ?? "", reason);
  advance(s, null); // битый трек сознательно не возвращается в луп очереди
}

function advance(s: Session, finished: Track | null): void {
  if (s.loopMode === "queue" && finished) s.queue.push(finished);
  if (s.queue.length > 0) { playNext(s.guildId); return; }
  s.current = null;
  refreshActivityTimer(s);
  notify(s.guildId);
}

export function moveToVoice(guildId: string, channelId: string): void {
  const s = sessions.get(guildId);
  if (!s || s.connection.joinConfig.channelId === channelId) return;
  try {
    s.connection.rejoin({ channelId, selfDeaf: true, selfMute: false });
  } catch (error) {
    logger.warn("[MUSIC] Не удалось переехать в канал автора", guildId, channelId, error);
  }
}
