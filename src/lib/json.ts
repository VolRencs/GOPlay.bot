import { automodDefaultActions } from "./automod.ts";

export function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as T | null;
    return parsed === null ? fallback : parsed;
  } catch { return fallback; }
}

export function parseStringArray(raw: string | null | undefined): string[] {
  const parsed = safeJson<unknown>(raw, []);
  return Array.isArray(parsed) ? parsed.filter(value => typeof value === "string") : [];
}

export function parseActions(raw: string | null | undefined): string[] {
  const parsed = parseStringArray(raw);
  return parsed.length ? parsed : [...automodDefaultActions];
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    const items = value.every(item => typeof item === "string") ? value.toSorted() : value;
    return `[${items.map(stableJson).join(",")}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}
