export const DAY_MS = 86_400_000;
export const MAX_TIMEOUT_SECONDS = 2_419_200;
export const DEFAULT_TIMEOUT_SECONDS = 300;
export const BOT_TOKEN_ERROR = "Бот недоступен. Попробуйте позже.";
export const SERVER_FALLBACK_NAME = "Discord server";

// Discord component-button style identifiers, shared by the bot's builders
// (значения совпадают с enum discord.js) и payload'ам панели.
export const BUTTON_STYLE_IDS = { primary: 1, secondary: 2, success: 3, danger: 4 } as const;
type ButtonStyleName = keyof typeof BUTTON_STYLE_IDS;
export const buttonStyleId = (name: string): number => Object.hasOwn(BUTTON_STYLE_IDS, name) ? BUTTON_STYLE_IDS[name as ButtonStyleName] : BUTTON_STYLE_IDS.primary;

/** Парсит число в диапазон: нечисло → fallback; mode — округление/целочисленность. */
export function clampNumber(value: unknown, fallback: number, min: number, max: number, mode: "exact" | "round" | "integer" = "exact"): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (mode === "integer" && !Number.isInteger(parsed)) return fallback;
  const next = mode === "round" ? Math.round(parsed) : parsed;
  return Math.min(max, Math.max(min, next));
}
