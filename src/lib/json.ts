// JSON из конфиг-колонок БД и тел запросов не должен ронять горячий путь.
import { automodDefaultActions } from "./automod.ts";

export function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function parseStringArray(raw: string | null | undefined): string[] {
  const parsed = safeJson<unknown>(raw, []);
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
}

// Пустой/битый payload → тот же дефолт, что применяет бот к ненастроенному правилу.
export function parseActions(raw: string | null | undefined): string[] {
  const parsed = safeJson<unknown>(raw, []);
  return Array.isArray(parsed) && parsed.length ? parsed.filter((value): value is string => typeof value === "string") : [...automodDefaultActions];
}

// Ключи сортируются: два payload'а с равным содержимым дают равную строку —
// так роуты настроек распознают no-op сохранения.
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}
