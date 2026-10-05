import { allowedAdminIds, canManageGuild, discordGuilds, isAllowedAccount, resolveSession } from "./guild-access.ts";
import { logger } from "../bot/utils/logger.ts";
import { discordFetch } from "./discord-api.ts";
import { ttlCacheAsync } from "./cache.ts";

export type AccountAccess =
  | { authenticated: false; allowed: false; canManage: false; isAdmin: false }
  | { authenticated: true; name: string; discordId: string; image: string | null; allowed: boolean; canManage: boolean; isAdmin: boolean };

const avatarCache = ttlCacheAsync<string, string | null>(async discordId => {
  try {
    const response = await discordFetch(`/users/${discordId}`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const { avatar } = await response.json() as { avatar?: string | null };
    if (avatar) return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.${avatar.startsWith("a_") ? "gif" : "png"}?size=128`;
    return `https://cdn.discordapp.com/embed/avatars/${(BigInt(discordId) >> 22n) % 6n}.png`;
  } catch {
    return null;
  }
}, 5 * 60_000);

export async function accessFrom(resolved: Awaited<ReturnType<typeof resolveSession>>): Promise<AccountAccess> {
  if (!resolved) return { authenticated: false, allowed: false, canManage: false, isAdmin: false };
  const { requestHeaders, user, discordAccount } = resolved;
  const allowed = isAllowedAccount(discordAccount);
  const isAdmin = Boolean(discordAccount && allowedAdminIds().includes(discordAccount.accountId));
  let canManage = false;
  if (discordAccount) try { canManage = (await discordGuilds(requestHeaders, discordAccount.id)).some(canManageGuild); } catch (e) { logger.warn("[WARN] Could not resolve Discord manage permission", e); }
  const freshImage = discordAccount ? await avatarCache.get(discordAccount.accountId) : null;
  return { authenticated: true, name: user.name, discordId: discordAccount?.accountId ?? "", image: freshImage ?? user.image ?? null, allowed, canManage, isAdmin };
}

export async function accountAccess(): Promise<AccountAccess> {
  return accessFrom(await resolveSession().catch(() => null));
}