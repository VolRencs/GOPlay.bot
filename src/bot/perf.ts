import { logger } from "./utils/logger.ts";

type DurationStats = { n: number; sum: number; max: number };
const counts = new Map<string, number>();
const durations = new Map<string, DurationStats>();

export function count(name: string) { counts.set(name, (counts.get(name) ?? 0) + 1); }

export function time(name: string, ms: number) {
  const stats = durations.get(name);
  if (!stats) { durations.set(name, { n: 1, sum: ms, max: ms }); return; }
  stats.n += 1;
  stats.sum += ms;
  if (ms > stats.max) stats.max = ms;
}

setInterval(() => {
  const parts: string[] = [];
  for (const [name, value] of counts) parts.push(`${name}: ${value}`);
  for (const [name, stats] of durations)
    if (stats.sum >= 1)
      parts.push(`${name}: ${stats.n}× avg ${Math.round(stats.sum / stats.n)}ms max ${Math.round(stats.max)}ms`);
  if (parts.length) logger.info("[PERF]", parts.join(" · "));
  counts.clear();
  durations.clear();
}, 10 * 60_000).unref();
