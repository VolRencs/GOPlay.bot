import type { Client, ClientEvents } from "discord.js";
import { guard } from "../lib/errors.ts";

export function on<K extends keyof ClientEvents>(
  client: Client,
  event: K,
  tag: string,
  handler: (...args: ClientEvents[K]) => unknown,
): void {
  client.on(event, (...args) => guard(tag, () => handler(...args)));
}

export function once<K extends keyof ClientEvents>(
  client: Client,
  event: K,
  tag: string,
  handler: (...args: ClientEvents[K]) => unknown,
): void {
  client.once(event, (...args) => guard(tag, () => handler(...args)));
}
