import { logger } from "./logger.ts";
import { MessageFlags, type Interaction, type RepliableInteraction } from "discord.js";

export function guard(scope: string, fn: () => unknown): void {
  void Promise.try(fn).catch((error: unknown) => logger.error(`[${scope}]`, error));
}

type RestLike = { code?: unknown; status?: unknown; rawError?: { code?: unknown } };

function replyInteractionError(i: RepliableInteraction, content: string): void {
  if (i.replied) return;
  void (i.deferred ? i.editReply(content) : i.reply({ content, flags: MessageFlags.Ephemeral })).catch(() => null);
}

export function failInteraction(message: string, i: Interaction, error: unknown, content: string, ...context: unknown[]): void {
  logger.warn(message, ...context, error);
  if (i.isRepliable()) replyInteractionError(i, content);
}

export function isMissingDiscordResource(error: unknown, kind: "message" | "channel" | "member" | "any" = "any"): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as RestLike;
  if (e.status === 404) return true;
  const codes = [e.code, e.rawError?.code].map(c => typeof c === "number" ? c : Number(c)).filter(Number.isFinite);
  if (kind === "message") return codes.includes(10008);
  if (kind === "channel") return codes.includes(10003);
  if (kind === "member") return codes.includes(10007);
  return codes.includes(10003) || codes.includes(10007) || codes.includes(10008);
}
