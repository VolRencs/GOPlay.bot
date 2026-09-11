import { NextResponse } from "next/server.js";
import { discordFetch, guildRoute, jsonError } from "../../../../../src/lib/guild-access.ts";
import { BOT_TOKEN_ERROR, SERVER_FALLBACK_NAME } from "../../../../../src/lib/constants.ts";
import { ttlCacheAsync } from "../../../../../src/lib/cache.ts";
import type { ResourcesGet } from "../../../../../src/components/dashboard/types.ts";

type DiscordChannel = { id: string; name: string; type: number; position: number };
type DiscordRole = { id: string; name: string; managed: boolean; position: number };
type DiscordEmoji = { id: string | null; name: string | null; animated: boolean };
type DiscordMember = { roles: string[] };

const ttl = 60_000;

const resourceCache = ttlCacheAsync<string, ResourcesGet>(async (guildId) => {
  const token = process.env.DISCORD_TOKEN, botUserId = process.env.DISCORD_CLIENT_ID;
  if (!token || !botUserId) throw new Error("DISCORD_TOKEN missing");
  return loadResources(guildId, botUserId);
}, ttl, true);

async function loadResources(guildId: string, botUserId: string): Promise<ResourcesGet> {
  const request = (path: string) => discordFetch(`/guilds/${guildId}/${path}`);
  const [channelsResponse, rolesResponse, emojisResponse, guildResponse, botMemberResponse] = await Promise.all([request("channels"), request("roles"), request("emojis"), discordFetch(`/guilds/${guildId}?with_counts=true`), request(`members/${botUserId}`)]);
  if (!channelsResponse.ok || !rolesResponse.ok || !botMemberResponse.ok) throw new Error("Discord guild resources are unavailable");

  const allChannels = await channelsResponse.json() as DiscordChannel[];
  const channels = allChannels.filter(channel => channel.type === 0 || channel.type === 5).sort((a, b) => a.position - b.position).map(({ id, name }) => ({ id, name }));
  const voiceChannels = allChannels.filter(channel => channel.type === 2).sort((a, b) => a.position - b.position).map(({ id, name }) => ({ id, name }));
  const categories = allChannels.filter(channel => channel.type === 4).sort((a, b) => a.position - b.position).map(({ id, name }) => ({ id, name }));
  const allRoles = await rolesResponse.json() as DiscordRole[];
  const botRoleIds = new Set((await botMemberResponse.json() as DiscordMember).roles);
  const botHighestPosition = allRoles.reduce((highest, role) => botRoleIds.has(role.id) ? Math.max(highest, role.position) : highest, 0);
  const roles = allRoles.filter(role => !role.managed && role.name !== "@everyone" && role.position < botHighestPosition).sort((a, b) => b.position - a.position).map(({ id, name }) => ({ id, name }));
  const emojis = emojisResponse.ok ? (await emojisResponse.json() as DiscordEmoji[]).filter(emoji => emoji.id && emoji.name).map(emoji => ({ id: emoji.id!, name: emoji.name!, animated: emoji.animated, value: `<${emoji.animated ? "a" : ""}:${emoji.name!}:${emoji.id!}>` })) : [];
  const guild = guildResponse.ok ? await guildResponse.json() as { name?: string; icon?: string | null; approximate_member_count?: number; approximate_presence_count?: number } : {};
  return { channels, voiceChannels, categories, roles, emojis, server: { name: guild.name ?? SERVER_FALLBACK_NAME, icon: guild.icon ?? null }, stats: { members: guild.approximate_member_count ?? null, online: guild.approximate_presence_count ?? null } };
}

export const GET = guildRoute(async (_, { guildId }) => {
  const token = process.env.DISCORD_TOKEN, botUserId = process.env.DISCORD_CLIENT_ID;
  if (!token || !botUserId) return jsonError(BOT_TOKEN_ERROR, 503);
  try { return NextResponse.json(await resourceCache.get(guildId)); }
  catch { return jsonError("Не удалось получить данные сервера. Убедитесь, что бот всё ещё на сервере.", 502); }
});
