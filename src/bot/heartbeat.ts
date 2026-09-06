// Сигнал «я жив» для админ-панели: бот пишет файл data/heartbeat с моментом
// работает ли процесс (файл старее ~3 минут — оффлайн).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const FILE = join(process.cwd(), "data", "heartbeat");
const startedAt = Date.now();

function write() {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify({ startedAt, ts: Date.now() }));
  } catch { /* диск недоступен — не критично */ }
}

export function startHeartbeat() {
  write();
  setInterval(write, 60_000).unref();
}
