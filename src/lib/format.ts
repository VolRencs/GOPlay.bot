const dateTime = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const number = new Intl.NumberFormat("ru-RU");
const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });

export const formatTime = (timestamp: number): string => dateTime.format(timestamp);

export const formatDay = (isoDay: string): string => day.format(new Date(`${isoDay}T00:00:00Z`));

export const formatNumber = (value: number): string => number.format(value);

export const formatLeaveAfter = (seconds: number): string =>
  seconds === 0 ? "выключен" : seconds % 60 === 0 ? `${seconds / 60} мин` : `${seconds} с`;

export const guildIconUrl = (guildId: string, icon: string | null | undefined, size = 128): string | null =>
  icon ? `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=${size}` : null;

export const channelRef = (id: string): string => `<#${id}>`;
export const roleRef = (id: string): string => `<@&${id}>`;
export const userRef = (id: string): string => `<@${id}>`;

export function progressBar(current: number, total: number, width: number, fullWhenZero = false): string {
  const filled = total > 0
    ? Math.min(width, Math.max(0, Math.round((current / total) * width)))
    : fullWhenZero ? width : 0;
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}
