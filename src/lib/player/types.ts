
export const MAX_QUEUE = 50;
export const MAX_PLAYLIST = 100;
/** Треки длиннее лимита отклоняются ещё на этапе метаданных. */
export const MAX_DURATION_SECONDS = 2 * 60 * 60;

export type Track = {
  query: string;
  title: string;
  requestedBy: string;
  /** Секунды; неизвестна до гидрации метаданных. */
  duration?: number;
  /** Прямой аудио-URL из -J экстракции: стрим без второго запуска yt-dlp. */
  mediaUrl?: string;
  mediaUrlExpiresAt?: number;
  /** Гидрация/префетч уже запущены — повторный вызов не нужен. */
  metaPending?: boolean;
};

export type LoopMode = "off" | "track" | "queue";
export const nextLoopMode = (mode: LoopMode): LoopMode => mode === "off" ? "track" : mode === "track" ? "queue" : "off";

/** Итог стрима одного запуска. Решение о судьбе трека принимает сессия.
 *  Наигранную позицию при eof сессия берёт из playbackDuration плеера. */
export type StreamOutcome =
  | { kind: "eof" }
  | { kind: "source-error"; detail: string }
  | { kind: "stall"; phase: "start" | "middle" }
  | { kind: "external" };

/** Достаточно ли играл трек для естественного конца (запас 15 c на неточность
 *  метаданных YouTube). Без длительности верим чистому завершению источника. */
export function isNaturalEnd(playedSec: number, durationSec: number | undefined): boolean {
  if (!durationSec || durationSec <= 0) return true;
  return playedSec >= Math.max(0, durationSec - 15);
}

/** «3:47» / «1:02:05» — длина трека для панели и /queue. */
export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Куда перейти ради автора нового трека: null — остаться на месте.
 *  Живём только в другом голосовом канале; непустой whitelist настроек
 *  ограничивает цели так же, как /play. */
export function pickFollowTarget(currentVc: string | null, requesterVc: string | null, whitelist: readonly string[]): string | null {
  if (!requesterVc || requesterVc === currentVc) return null;
  if (whitelist.length > 0 && !whitelist.includes(requesterVc)) return null;
  return requesterVc;
}

/** Разделение по индексам: [оставшиеся, удалённые]. Невалидные индексы
 *  игнорируются — гонка с живой очередью безопасна. */
export function partitionByIndices<T>(list: readonly T[], indices: readonly number[]): [T[], T[]] {
  const drop = new Set(indices.filter(i => Number.isInteger(i) && i >= 0 && i < list.length));
  if (!drop.size) return [[...list], []];
  const kept: T[] = [], gone: T[] = [];
  list.forEach((item, i) => (drop.has(i) ? gone : kept).push(item));
  return [kept, gone];
}

/** Перемещение: from → слот вставки to в исходной нумерации (length = в конец). */
export function moveWithinList<T>(list: T[], from: number, to: number): number {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return -1;
  if (from < 0 || from >= list.length || to < 0 || to > list.length) return -1;
  const [item] = list.splice(from, 1);
  const insertAt = to > from ? to - 1 : to;
  list.splice(insertAt, 0, item!);
  return insertAt;
}

/** Fisher-Yates на месте. */
export function shuffleWithin<T>(list: T[]): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
}
