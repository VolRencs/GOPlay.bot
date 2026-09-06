import { allowedAdminIds, canManageGuild, discordGuilds, isAllowedAccount, resolveSession } from "./guild-access.ts";
import { logger } from "../bot/utils/logger.ts";

export type AccountAccess =
  | { authenticated: false; allowed: false; canManage: false; isAdmin: false }
  | { authenticated: true; name: string; discordId: string; image: string | null; allowed: boolean; canManage: boolean; isAdmin: boolean };

export async function accountAccess(): Promise<AccountAccess> {
  const resolved = await resolveSession().catch(() => null);
  if (!resolved) return { authenticated: false, allowed: false, canManage: false, isAdmin: false };
  const { requestHeaders, user, discordAccount } = resolved;
  const allowed = isAllowedAccount(discordAccount);
  const isAdmin = Boolean(discordAccount && allowedAdminIds().includes(discordAccount.accountId));
  let canManage = false;
  if (discordAccount) try { canManage = (await discordGuilds(requestHeaders)).some(canManageGuild); } catch (e) { logger.warn("[WARN] Could not resolve Discord manage permission", e); }
  return { authenticated: true, name: user.name, discordId: discordAccount?.accountId ?? "", image: user.image ?? null, allowed, canManage, isAdmin };
}