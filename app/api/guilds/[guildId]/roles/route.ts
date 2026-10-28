import { NextResponse } from "next/server.js";
import { discordFetch, guildRoute, isSnowflake, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
import { withTransaction } from "../../../../../src/db/database.ts";
import { rolesQueries } from "../../../../../src/db/queries.ts";
import { recordDashboardChange, recordDashboardDiff } from "../../../../../src/lib/dashboard-audit.ts";
import { AUDIT_SECTION } from "../../../../../src/lib/audit-sections.ts";
import { logger } from "../../../../../src/lib/logger.ts";
import { BUTTON_STYLE_IDS, BOT_TOKEN_ERROR, buttonStyleId, type ButtonStyleName } from "../../../../../src/lib/constants.ts";
import { roleModeLabels, roleStyleLabels } from "../../../../../src/lib/labels.ts";
import { roleRef } from "../../../../../src/lib/mentions.ts";
import { REACTION_OPTION_LIMIT, SELECT_OPTION_LIMIT } from "../../../../../src/lib/limits.ts";
import type { RolePanelRow } from "../../../../../src/contracts/dashboard.ts";
import { parseCustomEmoji } from "goemoji/discord";

type PanelPayload = {
  panelId?: number; embedId: number; style: "buttons" | "select" | "reaction";
  roleLimit?: number; roleMode?: "toggle" | "add" | "remove"; notifyEnabled?: boolean; notifyTemplate?: string;
  options?: { roleId: string; label: string; emoji: string; buttonColor: string }[];
  channelId?: string; messageId?: string;
};
type DiscordRole = { id: string; managed: boolean; position: number };
type DiscordMember = { roles: string[] };
function discordEmoji(value?: string) {
  if (!value) return undefined;
  const custom = parseCustomEmoji(value);
  return custom ? { id: custom.id, name: custom.name, animated: custom.animated } : { name: value.replace(/[\uFE0E\uFE0F]/g, "") };
}
function reactionEmoji(value?: string) {
  const custom = value ? parseCustomEmoji(value) : null;
  if (custom) return `${custom.name}:${custom.id}`;
  return (value ?? "✅").replace(/[\uFE0E\uFE0F]/g, "");
}

const isButtonStyle = (value: unknown): value is ButtonStyleName => typeof value === "string" && Object.hasOwn(BUTTON_STYLE_IDS, value);

function readOptions(value: PanelPayload) {
  const valid = (raw: { roleId: string; label: string; emoji: string; buttonColor: string }[]) => raw
    .filter(o => Boolean(o) && typeof o === "object" && typeof o.roleId === "string" && o.roleId)
    .slice(0, SELECT_OPTION_LIMIT)
    .map(o => ({
      roleId: o.roleId,
      label: String(o.label ?? ""),
      emoji: typeof o.emoji === "string" ? o.emoji.replace(/[\uFE0E\uFE0F]/g, "").slice(0, 96) : "",
      buttonColor: isButtonStyle(o.buttonColor) ? o.buttonColor : "primary",
    }));
  if (Array.isArray(value.options)) return valid(value.options);
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
  return NextResponse.json(rolesQueries.list.all(guildId) as RolePanelRow[]);
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
  const tpl = rolesQueries.embedTemplate.get(value.embedId, guildId) as {name:string}|undefined;
  if (!tpl?.name) return jsonError("Шаблон не найден", 404);
  if (!value.channelId || !value.messageId) return jsonError("Выберите уже отправленное сообщение.");
  const embed = { channel_id: value.channelId, message_id: value.messageId, name: tpl.name };
  const token = process.env.DISCORD_TOKEN;
  if (!token) return jsonError(BOT_TOKEN_ERROR, 503);
  const assignable = await assignableRoleIds(guildId, options.map(o => o.roleId));
  if (assignable === null) return jsonError("Не удалось проверить иерархию ролей в Discord.", 502);
  if (options.some(o => !assignable.has(o.roleId))) return jsonError("Некоторые роли нельзя выдавать: переместите роль бота выше них в Discord.");
  const style = value.style === undefined ? "buttons" : value.style;
  if (!["buttons", "select", "reaction"].includes(style)) return jsonError("Некорректный тип панели.");
  if (style === "reaction") {
    if (options.length > REACTION_OPTION_LIMIT) return jsonError(`Для реакций доступно не более ${REACTION_OPTION_LIMIT} ролей.`);
    const reactionEmojis = options.map(o => reactionEmoji(o.emoji || undefined));
    if (new Set(reactionEmojis).size !== reactionEmojis.length) return jsonError("Эмодзи реакций должны быть уникальными.");
  }
  if (value.roleLimit !== undefined && value.roleLimit !== null && !Number.isInteger(Number(value.roleLimit))) return jsonError("Некорректный лимит ролей.");
  if (value.notifyTemplate !== undefined && value.notifyTemplate !== null && typeof value.notifyTemplate !== "string") return jsonError("Некорректный шаблон уведомления.");
  const roleLimit = Math.max(0, Math.min(SELECT_OPTION_LIMIT, Number(value.roleLimit) || 0));
  const roleMode = value.roleMode === undefined ? "toggle" : value.roleMode;
  if (!["toggle", "add", "remove"].includes(roleMode)) return jsonError("Некорректный режим выдачи ролей.");
  const template = (typeof value.notifyTemplate === "string" ? value.notifyTemplate.slice(0, 500) : "") || "✅ Выдана роль **{role}**";
  // Свежая строка панели создаётся первой: custom_id компонентов содержит её id
  // (`role:<panelId>:<roleId>`); при сбое Discord строка удаляется обратно.
  let panelId: number;
  let created = false;
  let beforePanel: { title: string; style: string; role_limit: number; role_mode: string; notify_enabled: number; notify_template: string | null } | undefined;
  let beforeRoleIds: string[] = [];
  if (value.panelId) {
    beforePanel = rolesQueries.panelGet.get(value.panelId, guildId) as typeof beforePanel;
    if (!beforePanel) return jsonError("Панель не найдена", 404);
    panelId = value.panelId;
    beforeRoleIds = (rolesQueries.panelOptions.all(panelId) as { role_id: string }[]).map(row => row.role_id);
  } else {
    panelId = Number(rolesQueries.insert.run(guildId, embed.channel_id, embed.message_id, embed.name, style, roleLimit, roleMode, +Boolean(value.notifyEnabled), template, Date.now()).lastInsertRowid);
    created = true;
  }
  const persistOptions = () => {
    withTransaction(() => {
      if (!created && rolesQueries.update.run(embed.channel_id, embed.message_id, embed.name, style, roleLimit, roleMode, +Boolean(value.notifyEnabled), template, Date.now(), panelId, guildId).changes === 0)
        throw new Error("panel deleted concurrently");
      rolesQueries.optionsDelete.run(panelId);
      for (const option of options) {
        const emoji = option.emoji ? option.emoji.replace(/[\uFE0E\uFE0F]/g, "").slice(0, 96) : "";
        rolesQueries.optionInsert.run(panelId, option.roleId, (option.label || embed.name).slice(0, 80), emoji || null, option.buttonColor);
      }
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
    const maxValues = roleLimit <= 0 ? Math.min(options.length, SELECT_OPTION_LIMIT) : Math.min(roleLimit, options.length);
    const component = { type: 3, custom_id: `roles:${panelId}`, placeholder: "Выберите роли", min_values: 0, max_values: maxValues, options: options.map(o => ({ label: (o.label || embed.name).slice(0, 100), value: o.roleId, emoji: discordEmoji(o.emoji || undefined) })) };
    const response = await discordFetch(`/channels/${embed.channel_id}/messages/${embed.message_id}`, { method: "PATCH", headers, body: JSON.stringify({ components: [{ type: 1, components: [component] }] }) });
    if (!response.ok) throw new Error(`patch ${response.status}`);
  } else {
    const buttons = options.map(o => ({ type: 2, style: buttonStyleId(o.buttonColor), label: (o.label || embed.name).slice(0, 80), custom_id: `role:${panelId}:${o.roleId}`, emoji: discordEmoji(o.emoji || undefined) }));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) rows.push({ type: 1, components: buttons.slice(i, i + 5) });
    const response = await discordFetch(`/channels/${embed.channel_id}/messages/${embed.message_id}`, { method: "PATCH", headers, body: JSON.stringify({ components: rows }) });
    if (!response.ok) throw new Error(`patch ${response.status}`);
  }
  } catch (error) {
    logger.warn("[ROLES] Привязка панели к сообщению не удалась", guildId, error);
    if (created) rolesQueries.rollbackDelete.run(panelId);
    return jsonError("Не удалось привязать элементы к исходному сообщению", 502);
  }
  try {
    persistOptions();
  } catch (error) {
    logger.warn("[ROLES] Панель удалена параллельно во время сохранения", guildId, error);
    void discordFetch(`/channels/${embed.channel_id}/messages/${embed.message_id}`, { method: "PATCH", headers, body: JSON.stringify({ components: [] }) }).catch(() => null);
    return jsonError("Панель была удалена другим модератором во время сохранения.", 409);
  }
  const styleLabel = roleStyleLabels[style] ?? style;
  if (beforePanel) {
    recordDashboardDiff(guildId, user, AUDIT_SECTION.roles, `Панель «${embed.name}»: `,
      {
        "Название": beforePanel.title,
        "Роли": beforeRoleIds.map(roleRef),
        "Стиль": roleStyleLabels[beforePanel.style] ?? beforePanel.style,
        "Лимит ролей": beforePanel.role_limit > 0 ? beforePanel.role_limit : "без лимита",
        "Режим": roleModeLabels[beforePanel.role_mode] ?? beforePanel.role_mode,
        "Уведомления": Boolean(beforePanel.notify_enabled),
        "Шаблон уведомления": beforePanel.notify_template,
      },
      {
        "Название": embed.name,
        "Роли": options.map(o => roleRef(o.roleId)),
        "Стиль": styleLabel,
        "Лимит ролей": roleLimit > 0 ? roleLimit : "без лимита",
        "Режим": roleModeLabels[roleMode] ?? roleMode,
        "Уведомления": Boolean(value.notifyEnabled),
        "Шаблон уведомления": template,
      });
  } else {
    recordDashboardChange(guildId, user, AUDIT_SECTION.roles, `Создана панель «${embed.name}» · ${options.length} ${styleLabel}`);
  }
  return NextResponse.json({ ok: true, panelId });
});

export const DELETE = guildRoute(async (request, { guildId, user }) => {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) return jsonError("Некорректный идентификатор панели.");
  const panel = rolesQueries.forDelete.get(id, guildId) as { channel_id: string; message_id: string; style: string; title: string } | undefined;
  if (!panel) return jsonError("Панель не найдена.", 404);
  const token = process.env.DISCORD_TOKEN;
  if (!token) return jsonError(BOT_TOKEN_ERROR, 503);
  const headers = { "content-type": "application/json" };
  let response: Response | undefined;
  try {
  if (panel.style === "reaction") {
    const options = rolesQueries.emojis.all(id) as { emoji: string | null }[];
    for (const option of options) {
      const current = await discordFetch(`/channels/${panel.channel_id}/messages/${panel.message_id}/reactions/${encodeURIComponent(reactionEmoji(option.emoji ?? undefined))}/@me`, { method: "DELETE" });
      if (response === undefined && !current.ok && current.status !== 404) response = current;
    }
  } else {
    response = await discordFetch(`/channels/${panel.channel_id}/messages/${panel.message_id}`, { method: "PATCH", headers, body: JSON.stringify({ components: [] }) });
  }
  } catch { response = undefined; }
  rolesQueries.delete.run(id, guildId);
  recordDashboardChange(guildId, user, AUDIT_SECTION.roles, `Удалена панель «${panel.title}»`);
  if (response && !response.ok && response.status !== 404) return NextResponse.json({ ok: true, warning: "Панель удалена из dashboard, но Discord не подтвердил удаление элементов." });
  return NextResponse.json({ ok: true });
});
