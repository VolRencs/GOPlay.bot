import type { Client } from "discord.js";
import { closeDatabase } from "../db/database.ts";
import { logger } from "../lib/logger.ts";
import { stopTimer } from "./config-cache.ts";
import { flushMetrics, stopMetrics } from "./metrics.ts";
import { applyLevelUps, flushLevels, stopLevels } from "./levels/index.ts";
import { flushMessageCache, stopMessageCache } from "../db/message-cache.ts";
import { flushLogs } from "./logging/index.ts";
import { stopEvents } from "./events/index.ts";
import { destroyAllSessions } from "../lib/player/index.ts";
import { stopHeartbeat } from "./heartbeat.ts";

let shuttingDown = false;

export async function shutdown(client: Client) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopHeartbeat();
  stopTimer();
  stopMetrics();
  stopLevels();
  stopEvents();
  stopMessageCache();
  try { flushMetrics(); } catch (error) { logger.warn("[METRICS] Не удалось слить метрики при остановке", error); }
  let levelUps: ReturnType<typeof flushLevels> = [];
  try { levelUps = flushLevels(); } catch (error) { logger.warn("[LEVELS] Не удалось слить XP при остановке", error); }
  try { flushMessageCache(); } catch (error) { logger.warn("[CACHE] Не удалось слить буфер при остановке", error); }
  logger.info("Остановка бота...");
  try { await flushLogs(); } catch (error) { logger.warn("[LOG] Не удалось слить логи при остановке", error); }
  // Events may have arrived while logs were draining; flush the final window once more.
  try { flushMetrics(); } catch (error) { logger.warn("[METRICS] Не удалось слить финальные метрики", error); }
  try { levelUps = levelUps.concat(flushLevels()); } catch (error) { logger.warn("[LEVELS] Не удалось слить финальный XP", error); }
  try { flushMessageCache(); } catch (error) { logger.warn("[CACHE] Не удалось слить финальный буфер", error); }
  if (levelUps.length) {
    try { await applyLevelUps(client, levelUps); } catch (error) { logger.warn("[LEVELS] Не удалось обработать повышения при остановке", error); }
  }
  destroyAllSessions();
  try { await client.destroy(); } catch (error) { logger.warn("[BOT] Ошибка при закрытии клиента", error); }
  closeDatabase();
  process.exit(0);
}
