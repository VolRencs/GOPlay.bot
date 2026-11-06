import { headers } from "next/headers.js";
import { hash } from "node:crypto";
import { auth } from "./auth.ts";
import { read, type ReadStatement } from "../db/typed.ts";
import { logger } from "./logger.ts";
import { ttlCacheAsync } from "./cache.ts";
import { BOT_TOKEN_ERROR, DAY_MS } from "./constants.ts";
import { DiscordRateLimitError, discordFetch, withRateLimitRetry } from "./discord-api.ts";

export { DiscordRateLimitError, discordFetch } from "./discord-api.ts";
type DiscordGuild = { id:string; permissions:string; owner:boolean; name:string; icon:string|null };
const manage=0x20n, admin=0x8n;
// Single source of truth for dashboard access; every entry point uses this predicate.
function allowedDiscordIds(): string[] {
  return (process.env.DASHBOARD_ALLOWED_DISCORD_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}
export function allowedAdminIds(): string[] {
  return (process.env.ADMIN_DISCORD_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
}
export function isAllowedAccount(discordAccount: { accountId: string } | undefined | null): boolean {
  const allowedIds = allowedDiscordIds();
  return !allowedIds.length || Boolean(discordAccount && allowedIds.includes(discordAccount.accountId));
}
// Keyed by access-token hash: a relogin naturally replaces the cache entry.
type GuildCache = { guilds?: DiscordGuild[]; expiresAt: number; staleUntil: number; pending: Promise<DiscordGuild[]> | undefined; lastError?: unknown; errorExpiresAt?: number };
const guildCache = new Map<string, GuildCache>();
const cacheKey = (token: string) => hash("sha256", token, "hex");
const guildExists = read<Record<string, unknown>>("SELECT 1 FROM guilds WHERE id=?");
let discordAccountStmt: ReadStatement<{ id: string; accountId: string }> | null = null;
export function discordAccountOf(userId: string) {
  discordAccountStmt ??= read<{ id: string; accountId: string }>("SELECT id, accountId FROM account WHERE userId=? AND providerId='discord'");
  return discordAccountStmt.get(userId);
}

class DiscordAuthError extends Error {}

function guildsRequest(accessToken: string): Promise<Response> {
  return fetch("https://discord.com/api/users/@me/guilds", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
}

async function requestGuilds(accessToken: string, retry = true): Promise<DiscordGuild[]> {
  return withRateLimitRetry<DiscordGuild[]>(
    await guildsRequest(accessToken),
    retry,
    (settled) => {
      if (!settled.ok) throw new Error(`Discord guilds request failed (${settled.status})`);
      return settled.json() as Promise<DiscordGuild[]>;
    },
    () => requestGuilds(accessToken, false),
  );
}
async function discordAccountId(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  const account = session?.user ? discordAccountOf(session.user.id) : undefined;
  if (!account) throw new Error("Discord account not linked");
  return account.id;
}
async function discordAccessToken(requestHeaders: Headers, accountId?: string) {
  return auth.api.getAccessToken({ body: { accountId: accountId ?? await discordAccountId(requestHeaders) }, headers: requestHeaders });
}
export async function discordGuilds(requestHeaders: Headers, accountId?: string) {
  const token = await discordAccessToken(requestHeaders, accountId);
  if (!token.accessToken) throw new DiscordAuthError("Discord access token missing");
  const key = cacheKey(token.accessToken), now = Date.now();
  for (const [k, e] of guildCache) if (k !== key && !e.pending && e.staleUntil < now) guildCache.delete(k);
  const existing = guildCache.get(key);
  if (existing?.guilds && existing.expiresAt > now) return existing.guilds;
  if (existing?.pending) return existing.pending;
  if (existing?.lastError && existing.errorExpiresAt && existing.errorExpiresAt > now) throw existing.lastError;
  const entry: GuildCache = existing ?? { expiresAt: 0, staleUntil: 0, pending: undefined };
  const load = async () => {
    try {
      let guilds: DiscordGuild[];
      try { guilds = await requestGuilds(token.accessToken); }
      catch (error) {
        // Old accounts may have no token expiry; refresh once on 401.
        if (!Error.isError(error) || !error.message.includes("(401)")) throw error;
        const refreshed = await auth.api.refreshToken({ body: { accountId: accountId ?? await discordAccountId(requestHeaders) }, headers: requestHeaders });
        if (!refreshed.accessToken) throw new Error("Discord refresh did not return an access token");
        guilds = await requestGuilds(refreshed.accessToken);
      }
      entry.guilds = guilds; entry.expiresAt = Date.now() + 60_000; entry.staleUntil = Date.now() + 10 * 60_000;
      delete entry.lastError; delete entry.errorExpiresAt;
      return guilds;
    } catch (error) {
      if (entry.guilds && entry.staleUntil > Date.now() && error instanceof DiscordRateLimitError) return entry.guilds;
      entry.lastError = error;
      entry.errorExpiresAt = Date.now() + 5_000 + Math.random() * 10_000;
      throw error;
    } finally { entry.pending = undefined; }
  };
  entry.pending = load(); guildCache.set(key, entry);
  return entry.pending;
}
export function canManageGuild(guild: DiscordGuild) { return guild.owner || (BigInt(guild.permissions) & (manage | admin)) !== 0n; }

export type DashboardGuild = { id: string; name: string; icon: string | null };

const configuredGuildsStmt = read<{ id: string }>("SELECT id FROM guilds WHERE id IN (SELECT value FROM json_each(?))");

export async function configuredGuilds(requestHeaders: Headers, accountId?: string): Promise<DashboardGuild[]> {
  const allowed = (await discordGuilds(requestHeaders, accountId)).filter(canManageGuild);
  if (!allowed.length) return [];
  const ids = allowed.slice(0, 200).map(guild => guild.id);
  const configured = new Set(configuredGuildsStmt.all(JSON.stringify(ids)).map(row => row.id));
  return allowed.filter(guild => configured.has(guild.id)).sort((a, b) => a.name.localeCompare(b.name)).map(({ id, name, icon }) => ({ id, name, icon }));
}

async function withGuild(guildId: string) {
  const access = await authorize(guildId);
  return access.ok ? access : Response.json({ error: access.error }, { status: access.status });
}

type SessionUser = NonNullable<Awaited<ReturnType<typeof resolveSession>>>["user"];

export function guildRoute<P extends { guildId: string } = { guildId: string }>(
  handler: (request: Request, ctx: { guildId: string; user: SessionUser; params: Omit<P, "guildId"> }) => Response | Promise<Response>,
) {
  return async (request: Request, context: { params: Promise<P> }): Promise<Response> => {
    const { guildId, ...rest } = await context.params;
    const access = await withGuild(guildId);
    if (access instanceof Response) return access;
    return handler(request, { guildId, user: access.user, params: rest });
  };
}

export function adminRoute<P extends Record<string, string> = Record<string, never>>(
  handler: (request: Request, params: P) => Response | Promise<Response>,
) {
  return async (request: Request, context: { params: Promise<P> }): Promise<Response> => {
    const gate = await requireAdmin();
    if (gate instanceof Response) return gate;
    return handler(request, await context.params);
  };
}

export async function resolveSession() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) return null;
  return { requestHeaders, user: session.user, discordAccount: discordAccountOf(session.user.id) };
}

async function requireUser() {
  const resolved = await resolveSession();
  if (!resolved) return { ok: false as const, error: "Unauthorized", status: 401 };
  const { user, discordAccount, requestHeaders } = resolved;
  if (!isAllowedAccount(discordAccount)) return { ok: false as const, error: "У этого аккаунта нет доступа к панели.", status: 403 };
  return { ok: true as const, user, discordAccount, requestHeaders };
}

async function requireAdmin(): Promise<{ ok: true } | Response> {
  const resolved = await resolveSession();
  if (!resolved) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = resolved.discordAccount?.accountId;
  if (!allowedAdminIds().includes(accountId ?? "")) return Response.json({ error: "Админ-панель доступна только владельцу бота." }, { status: 403 });
  return { ok: true };
}

function accessError(error: unknown) {
  if (error instanceof DiscordAuthError) return { ok: false as const, error: "Сессия Discord истекла. Войдите через Discord снова.", status: 403 };
  if (error instanceof DiscordRateLimitError) return { ok: false as const, error: "Discord временно ограничил запросы. Подождите несколько секунд и обновите страницу.", status: 429 };
  return { ok: false as const, error: "Не удалось проверить доступ Discord. Обновите страницу; если ошибка повторится, войдите через Discord снова.", status: 403 };
}

async function authorize(guildId: string) {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  let remote: DiscordGuild[];
  try {
    remote = await discordGuilds(gate.requestHeaders, gate.discordAccount?.id);
  } catch (error) {
    logger.warn("[WARN] Discord guild access failed", error);
    return accessError(error);
  }
  const guild = remote.find(x => x.id === guildId);
  if (!guild || !canManageGuild(guild)) return { ok: false as const, error: "У вас нет права «Управление сервером» на этом сервере.", status: 403 };
  if (!guildExists.get(guildId)) return { ok: false as const, error: "Guild is not configured", status: 404 };
  return { ok: true as const, user: gate.user };
}

export { isSnowflake, isSnowflakeArray, isSnowflakeOrNull } from "./ids.ts";

export const jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

export const botTokenError = () => jsonError(BOT_TOKEN_ERROR, 503);

// Content-Length is untrusted; read manually so chunked bodies cannot bypass the cap.
const MAX_JSON_BYTES = 1024 * 1024;
export async function readJsonRecord(request: Request): Promise<Record<string, unknown> | null> {
  const body = await readJson<unknown>(request);
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

export async function readJson<T>(request: Request): Promise<T | null> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) return null;
  if (!request.body) return null;
  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) { void reader.cancel(); return null; }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch { return null; }
}

const memberNamesCache = ttlCacheAsync<string, Map<string, string>>(async guildId => {
  const names = new Map<string, string>();
  let after = "0";
  for (;;) {
    const response = await discordFetch(`/guilds/${guildId}/members?limit=1000&after=${after}`);
    if (!response.ok) throw new Error(`Discord members request failed (${response.status})`);
    const batch = await response.json() as { user?: { id?: string; username?: string; global_name?: string | null }; nick?: string | null }[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const member of batch) {
      const user = member.user;
      if (!user?.id) continue;
      names.set(user.id, member.nick ?? user.global_name ?? user.username ?? user.id);
      if (user.id > after) after = user.id;
    }
    if (batch.length < 1000) break;
  }
  return names;
}, DAY_MS, true);
export const guildMemberNames = (guildId: string): Promise<Map<string, string>> => memberNamesCache.get(guildId);

// Small ID sets use per-member lookups; large sets fall back to full pagination.
const memberNameCache = ttlCacheAsync<string, string | null>(async key => {
  const [guildId, userId] = key.split(":");
  try {
    const response = await discordFetch(`/guilds/${guildId}/members/${userId}`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const member = await response.json() as { nick?: string | null; user?: { username?: string; global_name?: string | null } };
    return member.user ? member.nick ?? member.user.global_name ?? member.user.username ?? userId! : null;
  } catch { return null; }
}, DAY_MS, true);

export async function guildMemberNamesFor(guildId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  if (unique.length > 50) return guildMemberNames(guildId);
  const entries = await Promise.all(unique.map(async id => [id, await memberNameCache.get(`${guildId}:${id}`)] as const));
  return new Map(entries.filter((entry): entry is readonly [string, string] => entry[1] !== null));
}
