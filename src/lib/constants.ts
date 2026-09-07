export const DAY_MS = 86_400_000;
export const MAX_TIMEOUT_SECONDS = 2_419_200;
export const DEFAULT_TIMEOUT_SECONDS = 300;
export const BOT_TOKEN_ERROR = "Бот недоступен. Попробуйте позже.";
export const SERVER_FALLBACK_NAME = "Discord server";

// Discord component-button style identifiers, shared by the bot's builders
// (значения совпадают с enum discord.js) и payload'ам панели.
export const BUTTON_STYLE_IDS = { primary: 1, secondary: 2, success: 3, danger: 4 } as const;
type ButtonStyleName = keyof typeof BUTTON_STYLE_IDS;
export const buttonStyleId = (name: string): number => BUTTON_STYLE_IDS[name as ButtonStyleName] ?? BUTTON_STYLE_IDS.primary;
