import { logger } from "../bot/utils/logger.ts";
import { MessageFlags, type RepliableInteraction } from "discord.js";

/** Fire-and-forget вызов async-функции, трогающей SQLite/сеть, из gateway-
 *  обработчика: sync-throw или rejection логируются с контекстом вместо того,
 *  чтобы стать uncaughtException/unhandledRejection. Для «выстрелил и забыл»
 *  путей, у которых нет собственной обёртки try/catch. */
export function guard(scope: string, fn: () => unknown): void {
  try {
    const result = fn();
    if (result instanceof Promise) result.catch((error: unknown) => logger.error(`[${scope}]`, error));
  } catch (error) {
    logger.error(`[${scope}]`, error);
  }
}

type RestLike = { code?: unknown; status?: unknown; rawError?: { code?: unknown } };

/** Best-effort ответ пользователю из catch-блока обработчика интеракции.
 *  Отложенная интеракция без ответа висит как «думает…» вечно — поэтому
 *  deferred отвечаем через editReply, иначе ephemeral-ответом. */
export function replyInteractionError(i: RepliableInteraction, content: string): void {
  if (i.replied) return;
  void (i.deferred ? i.editReply(content) : i.reply({ content, flags: MessageFlags.Ephemeral })).catch(() => null);
}

/** «Ресурс реально удалён»: сообщение (10008), канал (10003) или HTTP 404.
 *  Понимает и DiscordAPIError, и сырые REST-ошибки (код в rawError). */
export function isMissingDiscordResource(error: unknown, kind: "message" | "channel" | "any" = "any"): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as RestLike;
  if (e.status === 404) return true;
  const codes = [e.code, e.rawError?.code].map(c => typeof c === "number" ? c : Number(c)).filter(Number.isFinite);
  if (kind !== "channel" && codes.includes(10008)) return true;
  if (kind !== "message" && codes.includes(10003)) return true;
  return false;
}
