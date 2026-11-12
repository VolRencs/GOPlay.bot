export const MAX_QUEUE = 50;
export const MAX_PLAYLIST = 100;
export const MAX_DURATION_SECONDS = 2 * 60 * 60;

export type Track = {
  query: string;
  title: string;
  requestedBy: string;
  duration?: number;
  thumbnail?: string;
  mediaUrl?: string;
  mediaHeaders?: Record<string, string>;
  mediaUrlExpiresAt?: number;
  hydrating?: boolean;
};

export type LoopMode = "off" | "track" | "queue";
export const nextLoopMode = (mode: LoopMode): LoopMode => mode === "off" ? "track" : mode === "track" ? "queue" : "off";

export type StreamOutcome =
  | { kind: "eof" }
  | { kind: "source-error"; detail: string; code?: string }
  | { kind: "stall"; phase: "start" | "middle" }
  | { kind: "external" };

const PERMANENT_SOURCE_CODES = new Set([
  "BOTCHECK", "AGE_RESTRICTED", "PRIVATE", "UNAVAILABLE", "UNSUPPORTED_URL",
  "INVALID_INPUT", "NO_AUDIO", "FORMAT_NOT_FOUND", "CHALLENGE_FAILED",
  "NATIVE_LOAD", "COOKIES", "TOO_LONG", "UNSAFE_URL",
]);

export function isRetryableFailure(outcome: StreamOutcome): boolean {
  if (outcome.kind === "eof" || outcome.kind === "stall") return true;
  if (outcome.kind !== "source-error") return false;
  return !outcome.code || !PERMANENT_SOURCE_CODES.has(outcome.code);
}

export function isNaturalEnd(playedSec: number, durationSec: number | undefined): boolean {
  if (!durationSec || durationSec <= 0) return true;
  return playedSec >= Math.max(0, durationSec - 15);
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function pickFollowTarget(currentVc: string | null, requesterVc: string | null, whitelist: readonly string[]): string | null {
  if (!requesterVc || requesterVc === currentVc) return null;
  if (whitelist.length > 0 && !whitelist.includes(requesterVc)) return null;
  return requesterVc;
}

export function partitionByIndices<T>(list: readonly T[], indices: readonly number[]): [T[], T[]] {
  const drop = new Set(indices.filter(i => Number.isInteger(i) && i >= 0 && i < list.length));
  if (!drop.size) return [[...list], []];
  const kept: T[] = [], gone: T[] = [];
  list.forEach((item, i) => (drop.has(i) ? gone : kept).push(item));
  return [kept, gone];
}

export function moveWithinList<T>(list: T[], from: number, to: number): number {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return -1;
  if (from < 0 || from >= list.length || to < 0 || to > list.length) return -1;
  const [item] = list.splice(from, 1);
  const insertAt = Math.min(to, list.length);
  list.splice(insertAt, 0, item!);
  return insertAt;
}

export function shuffleWithin<T>(list: T[]): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
}
