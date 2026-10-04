import { setTimeout as delay } from "node:timers/promises";

export class DiscordRateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) { super("Discord rate limit reached"); this.retryAfterMs = retryAfterMs; }
}

export async function withRateLimitRetry<T>(response: Response, retry: boolean, parse: (settled: Response) => Promise<T>, redo: () => Promise<T>): Promise<T> {
  if (response.status !== 429) return parse(response);
  const body = await response.clone().json().catch(() => null) as { retry_after?: unknown } | null;
  const raw = Number(body?.retry_after ?? response.headers.get("retry-after") ?? 1);
  const retryAfterMs = Math.max(250, Math.min(60_000, (Number.isFinite(raw) ? raw : 1) * 1000));
  if (retry && retryAfterMs <= 3_000) { await delay(retryAfterMs); return redo(); }
  throw new DiscordRateLimitError(retryAfterMs);
}

export async function discordFetch(path: string, init?: RequestInit, retry = true): Promise<Response> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN missing");
  const response = await fetch(`https://discord.com/api/v10${path}`, { ...init, headers: { ...(init?.headers as Record<string, string> ?? {}), Authorization: `Bot ${token}` }, cache: "no-store" });
  return withRateLimitRetry(response, retry, (settled) => Promise.resolve(settled), () => discordFetch(path, init, false));
}

export async function sendDiscordDM(userId: string, content: string): Promise<boolean> {
  if (!process.env.DISCORD_TOKEN) return false;
  try {
    const headers = { "content-type": "application/json" };
    const channel = await discordFetch(`/users/${userId}/channels`, { method: "POST", headers, body: JSON.stringify({ recipient_id: userId }) });
    if (!channel.ok) return false;
    const { id } = await channel.json() as { id: string };
    const message = await discordFetch(`/channels/${id}/messages`, { method: "POST", headers, body: JSON.stringify({ content: content.slice(0, 2000) }) });
    return message.ok;
  } catch { return false; }
}
