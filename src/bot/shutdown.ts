import type { Client } from "discord.js";
import { closeDatabase } from "../db/database.ts";
import { logger } from "../lib/logger.ts";
import { stopTimer } from "./config-cache.ts";
import { flushMetrics } from "./metrics.ts";
import { flushLevels } from "./levels/index.ts";
import { flushMessageCache } from "../db/message-cache.ts";
import { flushLogs } from "./logging/index.ts";
import { destroyAllSessions } from "../lib/player/index.ts";

export async function shutdown(client: Client) {
  stopTimer();
  flushMetrics();
  try { flushLevels(); } catch (error) { logger.warn("[LEVELS] Не удалось слить XP при остановке", error); }
  try { flushMessageCache(); } catch (error) { logger.warn("[CACHE] Не удалось слить буфер при остановке", error); }
  logger.info("Остановка бота...");
  // Логи дренируются перед выходом: очередь журнала иначе теряла бы самые
  // важные записи (модерация, удаления, входы).
  try { await flushLogs(); } catch (error) { logger.warn("[LOG] Не удалось слить логи при остановке", error); }
  destroyAllSessions();
  client.destroy();
  closeDatabase();
  process.exit(0);
}
