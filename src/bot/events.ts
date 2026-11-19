import { Events, type Client, type ClientEvents, type Interaction } from "discord.js";
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

type InteractionHandler = (interaction: Interaction) => unknown;
const interactionHandlers: InteractionHandler[] = [];

export function onInteraction(tag: string, handler: InteractionHandler): void {
  interactionHandlers.push(interaction => guard(tag, () => handler(interaction)));
}

export function registerInteractionDispatcher(client: Client): void {
  client.on(Events.InteractionCreate, interaction => {
    for (const handler of interactionHandlers) handler(interaction);
  });
}
