import { headers } from "next/headers.js";
import { NextResponse } from "next/server.js";
import { createHash } from "node:crypto";
import { auth } from "./auth.ts";
import { db } from "../db/database.ts";
import { logger } from "../bot/utils/logger.ts";
import { ttlCacheAsync } from "./cache.ts";
import { DAY_MS } from "./constants.ts";
type DiscordGuild = { id:string; permissions:string; owner:boolean; name:string; icon:string|null };
const manage=0x20n, admin=0x8n;
// Единственный источник allowlist: все серверные точки входа применяют одни правила.
function allowedDiscordIds(): string[] {
  return (process.env.DASHBOARD_ALLOWED_DISCORD_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}
// ID владельца бота: единственные, кому открыта админ-панель.
export function allowedAdminIds(): string[] {
  return (process.env.ADMIN_DISCORD_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
}
// Один предикат доступа для всех точек входа: requireUser и accountAccess
// обязаны оставаться логически обратными друг другу.
export function isAllowedAccount(discordAccount: { accountId: string } | undefined | null): boolean {
  const allowedIds = allowedDiscordIds();
  return !allowedIds.length || Boolean(discordAccount && allowedIds.includes(discordAccount.accountId));
}
type GuildCache = { guilds?: DiscordGuild[]; expiresAt: number; staleUntil: number; pending: Promise<DiscordGuild[]> | undefined; lastError?: unknown; errorExpiresAt?: number };
const guildCache = new Map<string, GuildCache>();
const cacheKey = (token: string) => createHash("sha256").update(token).digest("hex");
// Горячий путь всех API-роутов: prepared один раз на модуль.
const guildExists = db.prepare("SELECT 1 FROM guilds WHERE id=?");
// Таблица account создаётся миграциями better-auth (не нашими), поэтому
// statement готовится лениво при первом использовании, а не на импорте.
let discordAccountStmt: ReturnType<typeof db.prepare> | null = null;
export function discordAccountOf(userId: string) {
  discordAccountStmt ??= db.prepare("SELECT id, accountId FROM account WHERE userId=? AND providerId='discord'");
  return discordAccountStmt.get(userId) as { id: string; accountId: string } | undefined;
}

export class DiscordRateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) { super("Discord rate limit reached"); this.retryAfterMs = retryAfterMs; }
}

// Общий 429-хендлинг Discord REST: парсим и клампим retry_after, ретраим раз
// при коротком окне (у Discord часто субсекундные лимиты), иначе типизированная
// ошибка. `parse` разбирает ответ, `redo` делает единственный ретрай.
async function withRateLimitRetry<T>(response: Response, retry: boolean, parse: (settled: Response) => Promise<T>, redo: () => Promise<T>): Promise<T> {
  if (response.status !== 429) return parse(response);
  const body = await response.clone().json().catch(() => null) as { retry_after?: unknown } | null;
  const raw = Number(body?.retry_after ?? response.headers.get("retry-after") ?? 1);
  const retryAfterMs = Math.max(250, Math.min(60_000, (Number.isFinite(raw) ? raw : 1) * 1000));
  if (retry && retryAfterMs <= 3_000) { await new Promise<void>((resolve) => setTimeout(resolve, retryAfterMs)); return redo(); }
  throw new DiscordRateLimitError(retryAfterMs);
}

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
// Внутренний Better Auth id связанного Discord-аккаунта: читается из SQLite,
// браузерный account-cookie никогда не используется.
async function discordAccountId(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  const account = session?.user ? discordAccountOf(session.user.id) : undefined;
  if (!account) throw new Error("Discord account not linked");
  return account.id;
}
async function discordAccessToken(requestHeaders: Headers, accountId?: string) {
  return auth.api.getAccessToken({ body: { accountId: accountId ?? await discordAccountId(requestHeaders) }, headers: requestHeaders });
}
// accountId (внутренний id Better Auth) можно передать уже разрезолвленным:
// гейт requireUser уже валидировал сессию — второй getSession не нужен.
export async function discordGuilds(requestHeaders: Headers, accountId?: string) {
  const token = await discordAccessToken(requestHeaders, accountId), key = cacheKey(token.accessToken), now = Date.now();
  // Ключ — хеш access-token, который меняется при каждом перелогине: без
  // подчистки истёкших записей map рос бы бесконечно за время аптайма.
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
        // Старые аккаунты без expiry: токен возвращается как есть и Discord даёт
        // 401 — обновляем один раз.
        if (!(error instanceof Error) || !error.message.includes("(401)")) throw error;
        const refreshed = await auth.api.refreshToken({ body: { accountId: accountId ?? await discordAccountId(requestHeaders) }, headers: requestHeaders });
        if (!refreshed.accessToken) throw new Error("Discord refresh did not return an access token");
        guilds = await requestGuilds(refreshed.accessToken);
      }
      entry.guilds = guilds; entry.expiresAt = Date.now() + 60_000; entry.staleUntil = Date.now() + 10 * 60_000;
      delete entry.lastError; delete entry.errorExpiresAt;
      return guilds;
    } catch (error) {
      // Уже проверенный список безопасно отдать на время бэккоффа Discord —
      // настройки страницы не ломаются на 429.
      if (entry.guilds && entry.staleUntil > Date.now() && error instanceof DiscordRateLimitError) return entry.guilds;
      entry.lastError = error;
      entry.errorExpiresAt = Date.now() + 5_000 + Math.random() * 10_000;
      throw error;
    } finally { entry.pending = undefined; }
  };
  entry.pending = load(); guildCache.set(key, entry);
  return entry.pending;
}
// Связанный Discord-аккаунт пользователя панели; разом авторизует guild-роут
// и резолвит аккаунт сессии. canManageGuild — есть ли «Управление сервером».
export function canManageGuild(guild: DiscordGuild) { return guild.owner || (BigInt(guild.permissions) & (manage | admin)) !== 0n; }

async function withGuild(guildId: string) {
  const access = await authorize(guildId);
  return access.ok ? access : NextResponse.json({ error: access.error }, { status: access.status });
}

type SessionUser = NonNullable<Awaited<ReturnType<typeof resolveSession>>>["user"];

// Общая обёртка guild-роутов: резолвит guildId из сегментов, применяет withGuild
// и передаёт user/guildId/params в хендлер — вместо копии гейта в каждом хендлере.
export function guildRoute<P extends { guildId: string } = { guildId: string }>(
  handler: (request: Request, ctx: { guildId: string; user: SessionUser; params: Omit<P, "guildId"> }) => Response | Promise<Response>,
) {
  return async (request: Request, context: { params: Promise<P> }): Promise<Response> => {
    const { guildId, ...rest } = await context.params;
    const access = await withGuild(guildId);
    if (access instanceof Response) return access;
    return handler(request, { guildId, user: access.user, params: rest as Omit<P, "guildId"> });
  };
}

// Обёртка admin-API: requireAdmin возвращает готовый Response при отказе.
export function adminRoute<P extends Record<string, string> = Record<string, never>>(
  handler: (request: Request, params: P) => Response | Promise<Response>,
) {
  return async (request: Request, context: { params: Promise<P> }): Promise<Response> => {
    const gate = await requireAdmin();
    if (gate instanceof Response) return gate;
    return handler(request, await context.params);
  };
}

// Общий резолв сессии + Discord-аккаунта. API-роуты пробрасывают сбой
// getSession, лендинг терпит — решает вызывающий.
export async function resolveSession() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) return null;
  return { requestHeaders, user: session.user, discordAccount: discordAccountOf(session.user.id) };
}

// Общий гейт сессии + allowlist для списка серверов и всех guild-роутов:
// ни одна точка входа не открывает панель без логина и allowlist.
export async function requireUser() {
  const resolved = await resolveSession();
  if (!resolved) return { ok: false as const, error: "Unauthorized", status: 401 };
  // resolved.user.id — внутренний id Better Auth, а allowlist хранит
  // Discord-snowflake: сначала резолвим связанный аккаунт.
  const { user, discordAccount, requestHeaders } = resolved;
  if (!isAllowedAccount(discordAccount)) return { ok: false as const, error: "У этого аккаунта нет доступа к панели.", status: 403 };
  return { ok: true as const, user, discordAccount, requestHeaders };
}

// Гейт всех админ-API: сессия должна принадлежать Discord-аккаунту из списка
// владельца бота.
export async function requireAdmin(): Promise<{ ok: true } | NextResponse> {
  const resolved = await resolveSession();
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = resolved.discordAccount?.accountId;
  if (!allowedAdminIds().includes(accountId ?? "")) return NextResponse.json({ error: "Админ-панель доступна только владельцу бота." }, { status: 403 });
  return { ok: true };
}

async function authorize(guildId:string) {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  let remote: DiscordGuild[];
  try { remote = await discordGuilds(gate.requestHeaders, gate.discordAccount?.id); } catch (error) { logger.warn("[WARN] Discord guild access failed", error); const rateLimited = error instanceof DiscordRateLimitError; return {ok:false as const,error:rateLimited?"Discord временно ограничил запросы. Подождите несколько секунд и обновите страницу.":"Не удалось проверить доступ Discord. Обновите страницу; если ошибка повторится, войдите через Discord снова.",status:rateLimited?429:403} as const; }
  const guild=remote.find(x=>x.id===guildId); if(!guild||!canManageGuild(guild))return {ok:false as const,error:"У вас нет права «Управление сервером» на этом сервере.",status:403} as const;
  if(!guildExists.get(guildId))return {ok:false as const,error:"Guild is not configured",status:404} as const;
  return { ok: true as const, user: gate.user };
}

export const isSnowflake = (v: string) => /^\d{15,22}$/.test(v);
export const isSnowflakeArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string" && isSnowflake(item));

// Единый формат ошибок API: `{ error }` с нужным статусом.
export const jsonError = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Чтение JSON-тела: битый/пустой JSON → null, дальше роут проверяет форму.
export async function readJson<T>(request: Request): Promise<T | null> {
  try { return await request.json() as T; } catch { return null; }
}

export async function sendDiscordDM(userId: string, content: string): Promise<boolean> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) return false;
  try {
    const h = { Authorization: `Bot ${token}`, "content-type": "application/json" } as const;
    const ch = await fetch(`https://discord.com/api/v10/users/${userId}/channels`, { method: "POST", headers: h, body: JSON.stringify({ recipient_id: userId }), cache: "no-store" });
    if (!ch.ok) return false;
    const { id } = (await ch.json()) as { id: string };
    const msg = await fetch(`https://discord.com/api/v10/channels/${id}/messages`, { method: "POST", headers: h, body: JSON.stringify({ content: content.slice(0, 2000) }), cache: "no-store" });
    return msg.ok;
  } catch { return false; }
}

export async function discordFetch(path: string, init?: RequestInit, retry = true): Promise<Response> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN missing");
  const response = await fetch(`https://discord.com/api/v10${path}`, { ...init, headers: { ...(init?.headers as Record<string, string> ?? {}), Authorization: `Bot ${token}` }, cache: "no-store" });
  return withRateLimitRetry(response, retry, (settled) => Promise.resolve(settled), () => discordFetch(path, init, false));
}

// Имена участников гильдии: полная пагинация списка (одна страница — не более
// 1000), кэш на сутки со stale-fallback при ошибке Discord. Один общий
// источник для вкладок «Статистика» и «События», чтобы имена не расходились.
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
      // Snowflake сортируются лексикографически — это курсор следующей страницы.
      if (user.id > after) after = user.id;
    }
    if (batch.length < 1000) break;
  }
  return names;
}, DAY_MS, true);
export const guildMemberNames = (guildId: string): Promise<Map<string, string>> => memberNamesCache.get(guildId);
