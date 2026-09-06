// Ротация журнала бота: один раз при старте dev/start переносит выросший
// bot.log в bot.log.1 (прошлая копия затирается). Вызывается из package.json.
import { existsSync, renameSync, statSync } from "node:fs";

const log = new URL("../data/logs/bot.log", import.meta.url);
const LIMIT = 5 * 1024 * 1024;

if (existsSync(log) && statSync(log).size > LIMIT) {
  renameSync(log, new URL("../data/logs/bot.log.1", import.meta.url));
}
