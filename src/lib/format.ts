const dateTime = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const number = new Intl.NumberFormat("ru-RU");
const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });

/** Дата и время в едином формате панели. */
export const formatTime = (timestamp: number): string => dateTime.format(timestamp);

/** Дата без времени для подписей графика (ISO-день из БД). */
export const formatDay = (isoDay: string): string => day.format(new Date(`${isoDay}T00:00:00Z`));

/** Число в русской локали, без ручных toLocaleString по компонентам. */
export const formatNumber = (value: number): string => number.format(value);

/** Подпись автовыхода музыки: 0 — выключен, иначе минуты/секунды. */
export const formatLeaveAfter = (seconds: number): string =>
  seconds === 0 ? "выключен" : seconds % 60 === 0 ? `${seconds / 60} мин` : `${seconds} с`;
