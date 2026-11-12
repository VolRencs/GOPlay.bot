import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "../lib/logger.ts";

const FILE = join(process.cwd(), "data", "heartbeat");
const startedAt = Date.now();
let failures = 0;

function write() {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify({ startedAt, ts: Date.now() }));
    failures = 0;
  } catch (error) {
    failures = logger.warnEvery(failures, 10, "[HEARTBEAT] Не удалось записать файл", error);
  }
}

export function startHeartbeat() {
  write();
  setInterval(write, 60_000).unref();
}

export function stopHeartbeat() {
  try { rmSync(FILE, { force: true }); } catch (error) { logger.warn("[HEARTBEAT] Не удалось удалить файл", error); }
}
