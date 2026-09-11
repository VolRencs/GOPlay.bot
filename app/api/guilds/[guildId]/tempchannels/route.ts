import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
import { db, withTransaction } from "../../../../../src/db/database.ts";
import { parseStringArray, stableJson } from "../../../../../src/lib/json.ts";
import { DEFAULT_SETTINGS, clampUserLimit, type TempPutBody, type TempchannelsGet } from "../../../../../src/lib/tempchannels.ts";
import type { TempChannelConfig, TempPresetApi } from "../../../../../src/components/dashboard/types.ts";
import { stmt } from "../../../../../src/bot/db/statements.ts";
import { recordDashboardChange } from "../../../../../src/lib/dashboard-audit.ts";

type PresetRow = { id: number; name: string; trigger_channel_ids_json: string; category_id: string | null; name_template: string; user_limit: number; can_rename: number; can_manage_access: number; can_close: number };

const presetsDelete = db.prepare("DELETE FROM temp_channel_presets WHERE guild_id=?");
const presetsInsert = db.prepare("INSERT INTO temp_channel_presets(guild_id,name,trigger_channel_ids_json,category_id,name_template,user_limit,can_rename,can_manage_access,can_close,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)");

type ConfigPayload = TempChannelConfig;
function parseConfig(value: unknown): ConfigPayload {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const nameTemplate = typeof v.nameTemplate === "string" && v.nameTemplate.trim().length ? v.nameTemplate.trim().slice(0, 100) : DEFAULT_SETTINGS.name_template;
  return {
    categoryId: typeof v.categoryId === "string" && isSnowflake(v.categoryId) ? v.categoryId : null,
    nameTemplate,
    userLimit: clampUserLimit(v.userLimit),
    canRename: Boolean(v.canRename), canManageAccess: Boolean(v.canManageAccess), canClose: Boolean(v.canClose),
  };
}

function toJson(row: PresetRow): TempPresetApi {
  return { id: row.id, name: row.name, triggerChannelIds: parseStringArray(row.trigger_channel_ids_json), categoryId: row.category_id, nameTemplate: row.name_template, userLimit: row.user_limit, canRename: Boolean(row.can_rename), canManageAccess: Boolean(row.can_manage_access), canClose: Boolean(row.can_close) };
}

export const GET = guildRoute(async (_, { guildId }) => {
  return NextResponse.json<TempchannelsGet>({ presets: (stmt.tempPresets.all(guildId) as PresetRow[]).map(toJson) });
});

export const PUT = guildRoute(async (request, { guildId, user }) => {
  const body = await readJson<TempPutBody>(request);
  if (!body) return jsonError("Некорректные данные.");
  const rawPresets: unknown = body.presets;
  if (!Array.isArray(rawPresets) || rawPresets.length > 50) return jsonError("Некорректный список шаблонов.");
  const presets: { name: string; triggers: string[]; config: ConfigPayload }[] = [];
  for (const raw of rawPresets) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return jsonError("Некорректный шаблон.");
    const v = raw as Record<string, unknown>;
    const name = typeof v.name === "string" ? v.name.trim().slice(0, 100) : "";
    if (!name.length) return jsonError("Укажите название шаблона.");
    const triggers = Array.isArray(v.triggerChannelIds) ? v.triggerChannelIds.filter((id): id is string => typeof id === "string" && isSnowflake(id)).slice(0, 50) : [];
    if (!triggers.length) return jsonError("Выберите хотя бы один канал-триггер.");
    presets.push({ name, triggers, config: parseConfig(v.config) });
  }
  const existingRows = stmt.tempPresets.all(guildId) as PresetRow[];
  const canonical = (p: { name: string; triggers: string[]; config: ConfigPayload }) => stableJson({ name: p.name, triggers: [...p.triggers].sort(), config: { categoryId: p.config.categoryId, nameTemplate: p.config.nameTemplate, userLimit: p.config.userLimit, canRename: +p.config.canRename, canManageAccess: +p.config.canManageAccess, canClose: +p.config.canClose } });
  const existing = existingRows.map(row => canonical({ name: row.name, triggers: parseStringArray(row.trigger_channel_ids_json), config: { categoryId: row.category_id, nameTemplate: row.name_template, userLimit: row.user_limit, canRename: Boolean(row.can_rename), canManageAccess: Boolean(row.can_manage_access), canClose: Boolean(row.can_close) } }));
  if (stableJson(existing) === stableJson(presets.map(canonical))) {
    return NextResponse.json({ ok: true, unchanged: true, presets: existingRows.map(toJson) });
  }
  const timestamp = Date.now();
  withTransaction(() => {
    presetsDelete.run(guildId);
    for (const preset of presets) presetsInsert.run(guildId, preset.name, JSON.stringify(preset.triggers), preset.config.categoryId, preset.config.nameTemplate, preset.config.userLimit, preset.config.canRename ? 1 : 0, preset.config.canManageAccess ? 1 : 0, preset.config.canClose ? 1 : 0, timestamp);
  });
  const existingByName = new Map(existingRows.map((row, index) => [row.name, existing[index]!]));
  const nextNames = new Set(presets.map(preset => preset.name));
  const added = presets.filter(preset => !existingByName.has(preset.name)).map(preset => `«${preset.name}»`);
  const removed = existingRows.filter(row => !nextNames.has(row.name)).map(row => `«${row.name}»`);
  const changed = presets.filter(preset => { const was = existingByName.get(preset.name); return was !== undefined && was !== canonical(preset); }).map(preset => `«${preset.name}»`);
  const parts = [added.length ? `добавлены ${added.join(", ")}` : "", removed.length ? `удалены ${removed.join(", ")}` : "", changed.length ? `изменены ${changed.join(", ")}` : ""].filter(Boolean);
  recordDashboardChange(guildId, user, "Временные каналы", `Шаблоны: ${parts.join("; ")}`);
  return NextResponse.json({ ok: true, presets: (stmt.tempPresets.all(guildId) as PresetRow[]).map(toJson) });
});