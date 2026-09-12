type Level = "info" | "warn" | "error";

const debugEnabled = process.env.DEBUG === "1";

const COLORS: Record<Level, string> = {
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const LEVEL_LABEL: Record<Level, string> = {
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};
const RESET = "\x1b[0m";

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${pad(d.getFullYear())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Error.isError(value)) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

function emit(level: Level, parts: unknown[]) {
  if (level === "info" && !debugEnabled) return;
  const line = parts.map(safeString).join(" ");
  const stamp = timestamp();
  const label = LEVEL_LABEL[level].padEnd(5);
  const colored = `${COLORS[level]}${stamp} [${label}]${RESET} ${line}`;
  if (level === "error") console.error(colored);
  else if (level === "warn") console.warn(colored);
  else console.log(colored);
}

export const logger = {
  info: (...parts: unknown[]) => emit("info", parts),
  warn: (...parts: unknown[]) => emit("warn", parts),
  error: (...parts: unknown[]) => emit("error", parts),
  /** Спам-контроль ретрай-циклов: первая ошибка и далее каждая everyN-я. */
  warnEvery(count: number, everyN: number, ...parts: unknown[]): number {
    const next = count + 1;
    if (next === 1 || next % everyN === 0) emit("warn", [...parts, `повтор #${next}`]);
    return next;
  },
};
