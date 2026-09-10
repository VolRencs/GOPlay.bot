import { NextResponse } from "next/server.js";
import { discordFetch, guildRoute, isSnowflake, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
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
// Statements готовятся один раз на модуль: SQL статический, параметры через `?`.
const panelListStmt = db.prepare("SELECT p.*,o.role_id,o.label,o.emoji,o.button_color FROM self_role_panels p LEFT JOIN self_role_options o ON o.panel_id=p.id WHERE p.guild_id=? ORDER BY p.updated_at DESC");
const embedTemplateStmt = db.prepare("SELECT channel_id,message_id,name FROM embeds WHERE id=? AND guild_id=?");
const panelExistsStmt = db.prepare("SELECT id FROM self_role_panels WHERE id=? AND guild_id=?");
const panelInsertStmt = db.prepare("INSERT INTO self_role_panels(guild_id,channel_id,message_id,title,style,role_limit,role_mode,notify_enabled,notify_template,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
const panelUpdateStmt = db.prepare("UPDATE self_role_panels SET channel_id=?,message_id=?,title=?,style=?,role_limit=?,role_mode=?,notify_enabled=?,notify_template=?,updated_at=? WHERE id=? AND guild_id=?");
const panelRollbackDeleteStmt = db.prepare("DELETE FROM self_role_panels WHERE id=?");
const panelDeleteStmt = db.prepare("DELETE FROM self_role_panels WHERE id=? AND guild_id=?");
const panelOptionsDeleteStmt = db.prepare("DELETE FROM self_role_options WHERE panel_id=?");
const panelOptionInsertStmt = db.prepare("INSERT INTO self_role_options(panel_id,role_id,label,emoji,button_color) VALUES(?,?,?,?,?)");
const panelForDeleteStmt = db.prepare("SELECT p.channel_id,p.message_id,p.style,p.title FROM self_role_panels p WHERE p.id=? AND p.guild_id=?");
const panelEmojisStmt = db.prepare("SELECT emoji FROM self_role_options WHERE panel_id=?");
function discordEmoji(value?: string) {
  if (!value) return undefined;
  const custom = value.match(/^<(a?):([\w~]+):(\d+)>$/);
  return custom ? { name: custom[2], id: custom[3], animated: Boolean(custom[1]) } : { name: value };
}
function reactionEmoji(value?: string) { const emoji=discordEmoji(value); return emoji?.id ? `${emoji.name}:${emoji.id}` : emoji?.name ?? "✅"; }

function readOptions(value: PanelPayload) {
  const valid = (raw: { roleId: string; label: string; emoji: string; buttonColor: string }[]) => raw
    .filter(o => Boolean(o) && typeof o === "object" && typeof o.roleId === "string" && o.roleId)
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

export const GET = guildRoute(async (_, { guildId }) => {
  return NextResponse.json(panelListStmt.all(guildId) as RolePanelRow[]);
});

export const POST = guildRoute(async (request, { guildId, user }) => {
  const value = await readJson<PanelPayload>(request);
  if (!value) return jsonError("Некорректный запрос.");
  const options = readOptions(value);
  if (!options.length) return jsonError("Добавьте хотя бы одну роль.");
  if (!Number.isInteger(value.embedId)) return jsonError("Выберите отправленное сообщение.");
  // channelId/messageId/roleId интерполируются в путь Discord REST (и roleId
  // возвращается из custom_id кнопок в roles.add) — только snowflake.
  if ((value.channelId && !isSnowflake(value.channelId)) || (value.messageId && !isSnowflake(value.messageId)) || options.some(o => !isSnowflake(o.roleId)))
    return jsonError("Некорректный канал или роль.");
  const explicitMessage = Boolean(value.channelId && value.messageId);
  const tpl = embedTemplateStmt.get(value.embedId, guildId) as {channel_id:string;message_id:string;name:string}|undefined;
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
  if(!embed)return jsonError(explicitMessage?"Шаблон не найден":"Выберите уже отправленное сообщение", explicitMessage?404:400);
  const token = process.env.DISCORD_TOKEN;
  if (!token) return jsonError(BOT_TOKEN_ERROR, 503);
  const assignable = await assignableRoleIds(guildId, options.map(o => o.roleId));
  if (assignable === null) return jsonError("Не удалось проверить иерархию ролей в Discord.", 502);
  if (options.some(o => !assignable.has(o.roleId))) return jsonError("Некоторые роли нельзя выдавать: переместите роль бота выше них в Discord.");
  const style = ["buttons", "select", "reaction"].includes(value.style) ? value.style : "buttons";
  if (value.roleLimit !== undefined && value.roleLimit !== null && !Number.isInteger(Number(value.roleLimit))) return jsonError("Некорректный лимит ролей.");
  if (value.notifyTemplate !== undefined && value.notifyTemplate !== null && typeof value.notifyTemplate !== "string") return jsonError("Некорректный шаблон уведомления.");
  const roleLimit = Math.max(0, Math.min(25, Number(value.roleLimit) || 0));
  const roleMode = ["toggle", "add", "remove"].includes(value.roleMode ?? "") ? value.roleMode! : "toggle";
  const template = (typeof value.notifyTemplate === "string" ? value.notifyTemplate.slice(0, 500) : "") || "✅ Выдана роль **{role}**";
  // Свежая строка панели создаётся первой: custom_id компонентов содержит её id
  // (`role:<panelId>:<roleId>`); при сбое Discord строка удаляется обратно.
  let panelId: number;
  let created = false;
  if (value.panelId) {
    if (!panelExistsStmt.get(value.panelId, guildId)) return jsonError("Панель не найдена", 404);
    panelId = value.panelId;
  } else {
    panelId = Number(panelInsertStmt.run(guildId, embed.channel_id, embed.message_id, embed.name, style, roleLimit, roleMode, +Boolean(value.notifyEnabled), template, Date.now()).lastInsertRowid);
    created = true;
  }
  const persistOptions = () => {
    withTransaction(() => {
      // UPDATE … changes === 0 означает: панель удалена параллельным DELETE,
      // как компоненты уже были привязаны к сообщению (ghost-панель).
      if (!created && panelUpdateStmt.run(embed.channel_id, embed.message_id, embed.name, style, roleLimit, roleMode, +Boolean(value.notifyEnabled), template, Date.now(), panelId, guildId).changes === 0)
        throw new Error("panel deleted concurrently");
      panelOptionsDeleteStmt.run(panelId);
      for (const option of options) panelOptionInsertStmt.run(panelId, option.roleId, (option.label || embed.name).slice(0, 80), option.emoji?.slice(0, 96) || null, option.buttonColor);
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
    if (created) panelRollbackDeleteStmt.run(panelId);
    return jsonError("Не удалось привязать элементы к исходному сообщению", 502);
  }
  try {
    persistOptions();
  } catch (error) {
    logger.warn("[ROLES] Панель удалена параллельно во время сохранения", guildId, error);
    void discordFetch(`/channels/${embed.channel_id}/messages/${embed.message_id}`, { method: "PATCH", headers, body: JSON.stringify({ components: [] }) }).catch(() => null);
    return jsonError("Панель была удалена другим модератором во время сохранения.", 409);
  }
  const styleLabel = style === "reaction" ? "реакции" : style === "select" ? "список" : "кнопки";
  recordDashboardChange(guildId, user, "Роли", `${value.panelId ? "Изменена" : "Создана"} панель «${embed.name}» · ${options.length} ${styleLabel}`);
  return NextResponse.json({ ok: true, panelId });
});

export const DELETE = guildRoute(async (request, { guildId, user }) => {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) return jsonError("Некорректный идентификатор панели.");
  const panel = panelForDeleteStmt.get(id, guildId) as { channel_id: string; message_id: string; style: string; title: string } | undefined;
  if (!panel) return jsonError("Панель не найдена.", 404);
  const token = process.env.DISCORD_TOKEN;
  if (!token) return jsonError(BOT_TOKEN_ERROR, 503);
  const headers = { "content-type": "application/json" };
  let response: Response | undefined;
  try {
  if (panel.style === "reaction") {
    const options = panelEmojisStmt.all(id) as { emoji: string | null }[];
    for (const option of options) {
      const current = await discordFetch(`/channels/${panel.channel_id}/messages/${panel.message_id}/reactions/${encodeURIComponent(reactionEmoji(option.emoji ?? undefined))}/@me`, { method: "DELETE" });
      if (response === undefined && !current.ok && current.status !== 404) response = current;
    }
  } else {
    response = await discordFetch(`/channels/${panel.channel_id}/messages/${panel.message_id}`, { method: "PATCH", headers, body: JSON.stringify({ components: [] }) });
  }
  } catch { response = undefined; }
  panelDeleteStmt.run(id, guildId);
  recordDashboardChange(guildId, user, "Роли", `Удалена панель «${panel.title}»`);
  if (response && !response.ok && response.status !== 404) return NextResponse.json({ ok: true, warning: "Панель удалена из dashboard, но Discord не подтвердил удаление элементов." });
  return NextResponse.json({ ok: true });
});
