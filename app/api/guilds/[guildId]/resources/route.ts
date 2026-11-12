import { NextResponse } from "next/server.js";
import { botTokenError, discordFetch, guildRoute, jsonError } from "#lib/guild-access.ts";
import { SERVER_FALLBACK_NAME } from "#lib/constants.ts";
import { ttlCacheAsync } from "#lib/cache.ts";
import { assignableGuildRoles, guildResourceSnapshot } from "#lib/guild-resources.ts";
import type { ResourcesGet } from "#contracts/dashboard.ts";

type DiscordEmoji = { id: string | null; name: string | null; animated: boolean };

const ttl = 60_000;

const resourceCache = ttlCacheAsync<string, ResourcesGet>(async (guildId) => {
  return loadResources(guildId);
}, ttl, true);

async function loadResources(guildId: string): Promise<ResourcesGet> {
  const snapshot = await guildResourceSnapshot(guildId);
  const [emojisResponse, guildResponse] = await Promise.all([
    discordFetch(`/guilds/${guildId}/emojis`),
    discordFetch(`/guilds/${guildId}?with_counts=true`),
  ]);

  const channels = snapshot.channels.filter(channel => channel.type === 0 || channel.type === 5).sort((a, b) => a.position - b.position).map(({ id, name }) => ({ id, name }));
  const voiceChannels = snapshot.channels.filter(channel => channel.type === 2).sort((a, b) => a.position - b.position).map(({ id, name }) => ({ id, name }));
  const categories = snapshot.channels.filter(channel => channel.type === 4).sort((a, b) => a.position - b.position).map(({ id, name }) => ({ id, name }));
  const assignable = assignableGuildRoles(snapshot);
  if (!assignable) throw new Error("Не удалось определить роль бота на сервере");
  const roles = assignable.filter(role => role.name !== "@everyone").sort((a, b) => b.position - a.position).map(({ id, name }) => ({ id, name }));
  const emojis = emojisResponse.ok ? (await emojisResponse.json() as DiscordEmoji[]).filter(emoji => emoji.id && emoji.name).map(emoji => ({ id: emoji.id!, name: emoji.name!, animated: emoji.animated, value: `<${emoji.animated ? "a" : ""}:${emoji.name!}:${emoji.id!}>` })) : [];
  const guild = guildResponse.ok ? await guildResponse.json() as { name?: string; icon?: string | null; approximate_member_count?: number; approximate_presence_count?: number } : {};
  return { channels, voiceChannels, categories, roles, emojis, server: { name: guild.name ?? SERVER_FALLBACK_NAME, icon: guild.icon ?? null }, stats: { members: guild.approximate_member_count ?? null, online: guild.approximate_presence_count ?? null } };
}

export const GET = guildRoute(async (_, { guildId }) => {
  const token = process.env.DISCORD_TOKEN, botUserId = process.env.DISCORD_CLIENT_ID;
  if (!token || !botUserId) return botTokenError();
  try { return NextResponse.json(await resourceCache.get(guildId)); }
  catch { return jsonError("Не удалось получить данные сервера. Убедитесь, что бот всё ещё на сервере.", 502); }
});
