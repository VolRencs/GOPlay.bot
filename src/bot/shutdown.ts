import type { Client } from "discord.js";
import { closeDatabase } from "../db/database.ts";
import { logger } from "../lib/logger.ts";
import { stopTimer } from "./config-cache.ts";
import { flushMetrics } from "./metrics.ts";
import { flushLevels } from "./levels/index.ts";
import { flushMessageCache } from "../db/message-cache.ts";
import { flushLogs } from "./logging/index.ts";
import { destroyAllSessions } from "../lib/player/index.ts";
import { stopHeartbeat } from "./heartbeat.ts";

let shuttingDown = false;

export async function shutdown(client: Client) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopHeartbeat();
  stopTimer();
  flushMetrics();
  try { flushLevels(); } catch (error) { logger.warn("[LEVELS] Не удалось слить XP при остановке", error); }
  try { flushMessageCache(); } catch (error) { logger.warn("[CACHE] Не удалось слить буфер при остановке", error); }
  logger.info("Остановка бота...");
  try { await flushLogs(); } catch (error) { logger.warn("[LOG] Не удалось слить логи при остановке", error); }
  destroyAllSessions();
  try { await client.destroy(); } catch (error) { logger.warn("[BOT] Ошибка при закрытии клиента", error); }
  closeDatabase();
  process.exit(0);
}
