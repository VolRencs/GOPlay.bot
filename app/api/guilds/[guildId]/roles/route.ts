import { NextResponse } from "next/server.js";
import { discordFetch, isSnowflake, withGuild } from "../../../../../src/lib/guild-access.ts";
import { db, withTransaction } from "../../../../../src/db/database.ts";
import { recordDashboardChange } from "../../../../../src/lib/dashboard-audit.ts";
import { logger } from "../../../../../src/bot/utils/logger.ts";
import { BUTTON_STYLE_IDS, BOT_TOKEN_ERROR, buttonStyleId } from "../../../../../src/lib/constants.ts";
import type { RolePanelRow } from "../../../../../src/components/dashboard/types.ts";

type PanelPayload = {
  panelId?: number; embedId: number; style: "buttons" | "select" | "reaction";
  roleLimit?: number; roleMode?: "toggle" | "add" | "remove"; notifyEnabled?: boolean; notifyTemplate?: string;
  roleId?: string; label?: string; emoji?: string;
  options?: { roleId: string; label: string; emoji: string; buttonColor: string }[];
  channelId?: string; messageId?: string;
};
type DiscordRole = { id: string; managed: boolean; position: number };
type DiscordMember = { roles: string[] };
function discordEmoji(value?: string) {
  if (!value) return undefined;
  const custom = value.match(/^<(a?):([\w~]+):(\d+)>$/);
  return custom ? { name: custom[2], id: custom[3], animated: Boolean(custom[1]) } : { name: value };
}
function reactionEmoji(value?: string) { const emoji=discordEmoji(value); return emoji?.id ? `${emoji.name}:${emoji.id}` : emoji?.name ?? "✅"; }

function readOptions(value: PanelPayload) {
  const valid = (raw: { roleId: string; label: string; emoji: string; buttonColor: string }[]) => raw
    .filter(o => typeof o.roleId === "string" && o.roleId)
    .slice(0, 25)
    .map(o => ({
      roleId: o.roleId,
      label: String(o.label ?? ""),
      emoji: typeof o.emoji === "string" ? o.emoji.slice(0, 96) : "",
      buttonColor: typeof o.buttonColor === "string" && o.buttonColor in BUTTON_STYLE_IDS ? o.buttonColor : "primary",
    }));
  if (Array.isArray(value.options)) return valid(value.options);
  if (typeof value.roleId === "string" && value.roleId) return [{ roleId: value.roleId, label: typeof value.label === "string" ? value.label : String(value.label ?? ""), emoji: typeof value.emoji === "string" ? value.emoji.slice(0, 96) : "", buttonColor: "primary" }];
  return [];
}
async function assignableRoleIds(guildId: string, roleIds: string[]): Promise<Set<string> | null> {
  const botUserId = process.env.DISCORD_CLIENT_ID;
  if (!botUserId) return null;
  try {
    const [rolesResponse, memberResponse] = await Promise.all([discordFetch(`/guilds/${guildId}/roles`), discordFetch(`/guilds/${guildId}/members/${botUserId}`)]);
    if (!rolesResponse.ok || !memberResponse.ok) return null;
    const roles = await rolesResponse.json() as DiscordRole[];
    const botRoles = new Set((await memberResponse.json() as DiscordMember).roles);
    const highest = roles.reduce((position, role) => botRoles.has(role.id) ? Math.max(position, role.position) : position, 0);
    const byId = new Map(roles.map(role => [role.id, role]));
    return new Set(roleIds.filter(id => { const role = byId.get(id); return Boolean(role && !role.managed && role.position < highest); }));
  } catch { return null; }
}

export async function GET(_: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params, access = await withGuild(guildId);
  if (access instanceof Response) return access;
  return NextResponse.json(db.prepare("SELECT p.*,o.role_id,o.label,o.emoji,o.button_color FROM self_role_panels p LEFT JOIN self_role_options o ON o.panel_id=p.id WHERE p.guild_id=? ORDER BY p.updated_at DESC").all(guildId) as RolePanelRow[]);
}

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params, access = await withGuild(guildId);
  if (access instanceof Response) return access;
  const value = await request.json().catch(() => null) as PanelPayload | null;
  if (!value) return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  const options = readOptions(value);
  if (!options.length) return NextResponse.json({ error: "Добавьте хотя бы одну роль." }, { status: 400 });
  // channelId/messageId/roleId интерполируются в путь Discord REST (и roleId
  // возвращается из custom_id кнопок в roles.add) — только snowflake.
  if ((value.channelId && !isSnowflake(value.channelId)) || (value.messageId && !isSnowflake(value.messageId)) || options.some(o => !isSnowflake(o.roleId)))
    return NextResponse.json({ error: "Некорректный канал или роль." }, { status: 400 });
  const explicitMessage = Boolean(value.channelId && value.messageId);
  const tpl = db.prepare("SELECT channel_id,message_id,name FROM embeds WHERE id=? AND guild_id=?").get(value.embedId, guildId) as {channel_id:string;message_id:string;name:string}|undefined;
  const reqChannelId = value.channelId, reqMessageId = value.messageId;
  function resolveEmbed() {
    if (!tpl) return undefined;
    if (explicitMessage) {
      if (!tpl.name || !reqChannelId || !reqMessageId) return undefined;
      return { channel_id: reqChannelId, message_id: reqMessageId, name: tpl.name };
    }
    if (!tpl.channel_id || !tpl.message_id) return undefined;
    return { channel_id: tpl.channel_id, message_id: tpl.message_id, name: tpl.name };
  }
  const embed = resolveEmbed();
  if(!embed)return NextResponse.json({error:explicitMessage?"Шаблон не найден":"Выберите уже отправленное сообщение"},{status:explicitMessage?404:400});
  const token = process.env.DISCORD_TOKEN;
  if (!token) return NextResponse.json({ error: BOT_TOKEN_ERROR }, { status: 503 });
  const assignable = await assignableRoleIds(guildId, options.map(o => o.roleId));
  if (assignable === null) return NextResponse.json({ error: "Не удалось проверить иерархию ролей в Discord." }, { status: 502 });
  if (options.some(o => !assignable.has(o.roleId))) return NextResponse.json({ error: "Некоторые роли нельзя выдавать: переместите роль бота выше них в Discord." }, { status: 400 });
  const style = ["buttons", "select", "reaction"].includes(value.style) ? value.style : "buttons";
  if (value.roleLimit !== undefined && value.roleLimit !== null && !Number.isInteger(Number(value.roleLimit))) return NextResponse.json({ error: "Некорректный лимит ролей." }, { status: 400 });
  if (value.notifyTemplate !== undefined && value.notifyTemplate !== null && typeof value.notifyTemplate !== "string") return NextResponse.json({ error: "Некорректный шаблон уведомления." }, { status: 400 });
  const roleLimit = Math.max(0, Math.min(25, Number(value.roleLimit) || 0));
  const roleMode = ["toggle", "add", "remove"].includes(value.roleMode ?? "") ? value.roleMode! : "toggle";
  const template = (typeof value.notifyTemplate === "string" ? value.notifyTemplate.slice(0, 500) : "") || "✅ Выдана роль **{role}**";
  // Свежая строка панели создаётся первой: custom_id компонентов содержит её id
  // (`role:<panelId>:<roleId>`); при сбое Discord строка удаляется обратно.
  let panelId: number;
  let created = false;
  if (value.panelId) {
    if (!db.prepare("SELECT id FROM self_role_panels WHERE id=? AND guild_id=?").get(value.panelId, guildId)) return NextResponse.json({ error: "Панель не найдена" }, { status: 404 });
    panelId = value.panelId;
  } else {
    panelId = Number(db.prepare("INSERT INTO self_role_panels(guild_id,channel_id,message_id,title,style,role_limit,role_mode,notify_enabled,notify_template,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(guildId, embed.channel_id, embed.message_id, embed.name, style, roleLimit, roleMode, +Boolean(value.notifyEnabled), template, Date.now()).lastInsertRowid);
    created = true;
  }
  const persistOptions = () => {
    withTransaction(() => {
      // UPDATE … changes === 0 означает: панель удалена параллельным DELETE,
      // как компоненты уже были привязаны к сообщению (ghost-панель).
      if (!created && db.prepare("UPDATE self_role_panels SET channel_id=?,message_id=?,title=?,style=?,role_limit=?,role_mode=?,notify_enabled=?,notify_template=?,updated_at=? WHERE id=? AND guild_id=?").run(embed.channel_id, embed.message_id, embed.name, style, roleLimit, roleMode, +Boolean(value.notifyEnabled), template, Date.now(), panelId, guildId).changes === 0)
        throw new Error("panel deleted concurrently");
      db.prepare("DELETE FROM self_role_options WHERE panel_id=?").run(panelId);
      const insert = db.prepare("INSERT INTO self_role_options(panel_id,role_id,label,emoji,button_color) VALUES(?,?,?,?,?)");
      for (const option of options) insert.run(panelId, option.roleId, (option.label || embed.name).slice(0, 80), option.emoji?.slice(0, 96) || null, option.buttonColor);
    });
  };
  const headers = { "content-type": "application/json" };
  try {
  if (style === "reaction") {
    for (const option of options) {
      // Каждая реакция проверяется: rate limit на первой не маскируется
      // успешной третьей.
      const added = await discordFetch(`/channels/${embed.channel_id}/messages/${embed.message_id}/reactions/${encodeURIComponent(reactionEmoji(option.emoji || undefined))}/@me`, { method: "PUT" });
      if (!added.ok) throw new Error(`reaction ${added.status}`);
    }
  } else if (style === "select") {
    const maxValues = roleLimit <= 0 ? Math.min(options.length, 25) : Math.min(roleLimit, options.length);
    const component = { type: 3, custom_id: `roles:${panelId}`, placeholder: "Выберите роли", min_values: 0, max_values: maxValues, options: options.map(o => ({ label: (o.label || embed.name).slice(0, 100), value: o.roleId, emoji: discordEmoji(o.emoji || undefined) })) };
    const response = await discordFetch(`/channels/${embed.channel_id}/messages/${embed.message_id}`, { method: "PATCH", headers, body: JSON.stringify({ components: [{ type: 1, components: [component] }] }) });
    if (!response.ok) throw new Error(`patch ${response.status}`);
  } else {
    const buttons = options.map(o => ({ type: 2, style: buttonStyleId(o.buttonColor), label: (o.label || embed.name).slice(0, 80), custom_id: `role:${panelId}:${o.roleId}`, emoji: discordEmoji(o.emoji || undefined) }));
    const response = await discordFetch(`/channels/${embed.channel_id}/messages/${embed.message_id}`, { method: "PATCH", headers, body: JSON.stringify({ components: [{ type: 1, components: buttons }] }) });
    if (!response.ok) throw new Error(`patch ${response.status}`);
  }
  } catch (error) {
    logger.warn("[ROLES] Привязка панели к сообщению не удалась", guildId, error);
    if (created) db.prepare("DELETE FROM self_role_panels WHERE id=?").run(panelId);
    return NextResponse.json({ error: "Не удалось привязать элементы к исходному сообщению" }, { status: 502 });
  }
  try {
    persistOptions();
  } catch (error) {
    logger.warn("[ROLES] Панель удалена параллельно во время сохранения", guildId, error);
    void discordFetch(`/channels/${embed.channel_id}/messages/${embed.message_id}`, { method: "PATCH", headers, body: JSON.stringify({ components: [] }) }).catch(() => null);
    return NextResponse.json({ error: "Панель была удалена другим модератором во время сохранения." }, { status: 409 });
  }
  const styleLabel = style === "reaction" ? "реакции" : style === "select" ? "список" : "кнопки";
  recordDashboardChange(guildId, access.user, "Роли", `${value.panelId ? "Изменена" : "Создана"} панель «${embed.name}» · ${options.length} ${styleLabel}`);
  return NextResponse.json({ ok: true, panelId });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params, access = await withGuild(guildId);
  if (access instanceof Response) return access;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Некорректный идентификатор панели." }, { status: 400 });
  const panel = db.prepare("SELECT p.channel_id,p.message_id,p.style,p.title FROM self_role_panels p WHERE p.id=? AND p.guild_id=?").get(id, guildId) as { channel_id: string; message_id: string; style: string; title: string } | undefined;
  if (!panel) return NextResponse.json({ error: "Панель не найдена." }, { status: 404 });
  const token = process.env.DISCORD_TOKEN;
  if (!token) return NextResponse.json({ error: BOT_TOKEN_ERROR }, { status: 503 });
  const headers = { "content-type": "application/json" };
  let response: Response | undefined;
  try {
  if (panel.style === "reaction") {
    const options = db.prepare("SELECT emoji FROM self_role_options WHERE panel_id=?").all(id) as { emoji: string | null }[];
    for (const option of options) {
      const current = await discordFetch(`/channels/${panel.channel_id}/messages/${panel.message_id}/reactions/${encodeURIComponent(reactionEmoji(option.emoji ?? undefined))}/@me`, { method: "DELETE" });
      if (response === undefined && !current.ok && current.status !== 404) response = current;
    }
  } else {
    response = await discordFetch(`/channels/${panel.channel_id}/messages/${panel.message_id}`, { method: "PATCH", headers, body: JSON.stringify({ components: [] }) });
  }
  } catch { response = undefined; }
  db.prepare("DELETE FROM self_role_panels WHERE id=? AND guild_id=?").run(id, guildId);
  recordDashboardChange(guildId, access.user, "Роли", `Удалена панель «${panel.title}»`);
  if (response && !response.ok && response.status !== 404) return NextResponse.json({ ok: true, warning: "Панель удалена из dashboard, но Discord не подтвердил удаление элементов." });
  return NextResponse.json({ ok: true });
}
