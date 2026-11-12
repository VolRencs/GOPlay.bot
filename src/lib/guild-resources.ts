import { ttlCacheAsync } from "./cache.ts";
import { assignableRoles, discordFetch } from "./discord-api.ts";

type GuildChannel = { id: string; name: string; type: number; position: number };
type GuildRole = { id: string; name: string; managed: boolean; position: number };

type GuildResourceSnapshot = {
  channels: GuildChannel[];
  roles: GuildRole[];
  botRoleIds: Set<string> | null;
};

type GuildResourceFetcher = (path: string) => Promise<Response>;

type ResourceValidation =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 502 | 503 };

type ChannelSpec = {
  ids: readonly (string | null | undefined)[];
  types?: readonly number[];
};

type RoleSpec = {
  ids: readonly (string | null | undefined)[];
  assignable?: boolean;
  allowEveryone?: boolean;
};

type MessageSpec = { channelId: string; messageId: string };

type ResourceSpec = {
  channels?: ChannelSpec;
  roles?: RoleSpec;
  messages?: readonly MessageSpec[];
};

export const CHANNEL_TYPES = {
  text: [0, 5],
  voice: [2, 13],
  category: [4],
} as const;

const CACHE_TTL = 60_000;

function uniqueIds(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function discordError(message: string): ResourceValidation {
  return { ok: false, error: message, status: 502 };
}

export async function loadGuildResourceSnapshot(
  guildId: string,
  fetcher: GuildResourceFetcher = discordFetch,
): Promise<GuildResourceSnapshot> {
  const botUserId = process.env.DISCORD_CLIENT_ID;
  const memberRequest = botUserId
    ? fetcher(`/guilds/${guildId}/members/${botUserId}`).catch(() => null)
    : Promise.resolve(null);
  const [channelsResponse, rolesResponse, memberResponse] = await Promise.all([
    fetcher(`/guilds/${guildId}/channels`),
    fetcher(`/guilds/${guildId}/roles`),
    memberRequest,
  ]);
  if (!channelsResponse.ok || !rolesResponse.ok) {
    throw new Error(`Discord guild resources request failed (${channelsResponse.status}/${rolesResponse.status})`);
  }
  const channels = await channelsResponse.json() as GuildChannel[];
  const roles = await rolesResponse.json() as GuildRole[];
  let botRoleIds: Set<string> | null = null;
  if (memberResponse?.ok) {
    const member = await memberResponse.json() as { roles?: unknown };
    if (Array.isArray(member.roles)) botRoleIds = new Set(member.roles.filter((id): id is string => typeof id === "string"));
  }
  return { channels, roles, botRoleIds };
}

export function validateSnapshot(
  snapshot: GuildResourceSnapshot,
  guildId: string,
  spec: ResourceSpec,
): ResourceValidation {
  const channelIds = uniqueIds(spec.channels?.ids ?? []);
  if (channelIds.length) {
    const byId = new Map(snapshot.channels.map(channel => [channel.id, channel]));
    const allowedTypes = spec.channels?.types;
    for (const id of channelIds) {
      const channel = byId.get(id);
      if (!channel) return { ok: false, error: "Канал не найден на этом сервере.", status: 400 };
      if (allowedTypes && !allowedTypes.includes(channel.type)) {
        return { ok: false, error: "Выбран канал неподходящего типа.", status: 400 };
      }
    }
  }

  const roleIds = uniqueIds(spec.roles?.ids ?? []);
  if (roleIds.length) {
    const byId = new Map(snapshot.roles.map(role => [role.id, role]));
    for (const id of roleIds) {
      const role = byId.get(id);
      if (!role) return { ok: false, error: "Роль не найдена на этом сервере.", status: 400 };
      if (!spec.roles?.allowEveryone && (id === guildId || role.name === "@everyone")) {
        return { ok: false, error: "Нельзя выбрать роль @everyone.", status: 400 };
      }
    }
    if (spec.roles?.assignable) {
      if (!snapshot.botRoleIds) {
        return { ok: false, error: "Не удалось определить роль бота на сервере.", status: 502 };
      }
      const assignable = new Set(assignableRoles(snapshot.roles, snapshot.botRoleIds).map(role => role.id));
      for (const id of roleIds) {
        if (!assignable.has(id)) {
          return { ok: false, error: "Некоторые роли выше роли бота — их нельзя выдавать.", status: 400 };
        }
      }
    }
  }

  return { ok: true };
}

async function validateMessages(
  snapshot: GuildResourceSnapshot,
  messages: readonly MessageSpec[],
  fetcher: GuildResourceFetcher,
): Promise<ResourceValidation> {
  if (!messages.length) return { ok: true };
  const channels = new Set(snapshot.channels.map(channel => channel.id));
  const unique = new Map(messages.map(message => [`${message.channelId}:${message.messageId}`, message]));
  for (const message of unique.values()) {
    if (!channels.has(message.channelId)) {
      return { ok: false, error: "Канал не найден на этом сервере.", status: 400 };
    }
    let response: Response;
    try {
      response = await fetcher(`/channels/${message.channelId}/messages/${message.messageId}`);
    } catch {
      return discordError("Не удалось проверить сообщение в Discord. Попробуйте позже.");
    }
    if (response.status === 404) return { ok: false, error: "Сообщение не найдено в этом сервере.", status: 400 };
    if (!response.ok) return discordError("Не удалось проверить сообщение в Discord. Попробуйте позже.");
  }
  return { ok: true };
}

export function createGuildResourceValidator(fetcher: GuildResourceFetcher = discordFetch) {
  const cache = ttlCacheAsync<string, GuildResourceSnapshot>(
    guildId => loadGuildResourceSnapshot(guildId, fetcher),
    CACHE_TTL,
    true,
  );

  return {
    snapshot(guildId: string): Promise<GuildResourceSnapshot> {
      return cache.get(guildId);
    },
    async validate(guildId: string, spec: ResourceSpec): Promise<ResourceValidation> {
      const needsSnapshot = Boolean(
        (spec.channels?.ids?.length) || (spec.roles?.ids?.length) || (spec.messages?.length),
      );
      if (!needsSnapshot) return { ok: true };
      if (!process.env.DISCORD_TOKEN) {
        return { ok: false, error: "Бот недоступен. Попробуйте позже.", status: 503 };
      }
      let snapshot: GuildResourceSnapshot;
      try {
        snapshot = await cache.get(guildId);
      } catch {
        return discordError("Не удалось проверить ресурсы Discord. Попробуйте позже.");
      }
      const base = validateSnapshot(snapshot, guildId, spec);
      if (!base.ok) return base;
      return validateMessages(snapshot, spec.messages ?? [], fetcher);
    },
  };
}

const defaultValidator = createGuildResourceValidator();

export const guildResourceSnapshot = defaultValidator.snapshot;
export const validateResources = defaultValidator.validate;

export const resourceError = (result: Extract<ResourceValidation, { ok: false }>): Response =>
  Response.json({ error: result.error }, { status: result.status });

export function assignableGuildRoles(snapshot: GuildResourceSnapshot): GuildRole[] | null {
  if (!snapshot.botRoleIds) return null;
  return assignableRoles(snapshot.roles, snapshot.botRoleIds);
}
