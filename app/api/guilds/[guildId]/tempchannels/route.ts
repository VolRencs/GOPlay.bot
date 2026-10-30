import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, jsonError, readJson } from "#lib/guild-access.ts";
import { withTransaction } from "#db/database.ts";
import { tempchannelQueries } from "#db/queries.ts";
import { parseStringArray, stableJson } from "#lib/json.ts";
import { clampUserLimit, type TempPresetRow } from "#lib/tempchannels.ts";
import { defaultTempConfig, fromDto as fromTempPresetDto, toDto as toTempPresetDto, type TempChannelConfigDto, type TempPutBody, type TempchannelsDto } from "#contracts/tempchannels.ts";
import { stmt } from "#db/statements.ts";
import { recordDashboardChange } from "#lib/dashboard-audit.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";

function parseConfig(value: unknown): TempChannelConfigDto {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const nameTemplate = typeof v.nameTemplate === "string" && v.nameTemplate.trim().length ? v.nameTemplate.trim().slice(0, 100) : defaultTempConfig.nameTemplate;
  return {
    categoryId: typeof v.categoryId === "string" && isSnowflake(v.categoryId) ? v.categoryId : null,
    nameTemplate,
    userLimit: clampUserLimit(v.userLimit),
    canRename: v.canRename === undefined ? true : Boolean(v.canRename),
    canManageAccess: v.canManageAccess === undefined ? true : Boolean(v.canManageAccess),
    canClose: v.canClose === undefined ? true : Boolean(v.canClose),
  };
}

function toJson(row: TempPresetRow) {
  return toTempPresetDto(row);
}

export const GET = guildRoute(async (_, { guildId }) => {
  return NextResponse.json<TempchannelsDto>({ presets: stmt.tempPresets.all(guildId).map(toJson) });
});

export const PUT = guildRoute(async (request, { guildId, user }) => {
  const body = await readJson<TempPutBody>(request);
  if (!body) return jsonError("Некорректные данные.");
  const rawPresets: unknown = body.presets;
  if (!Array.isArray(rawPresets) || rawPresets.length > 50) return jsonError("Некорректный список шаблонов.");
  const presets: { name: string; triggers: string[]; config: TempChannelConfigDto }[] = [];
  for (const raw of rawPresets) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return jsonError("Некорректный шаблон.");
    const v = raw as Record<string, unknown>;
    const name = typeof v.name === "string" ? v.name.trim().slice(0, 100) : "";
    if (!name.length) return jsonError("Укажите название шаблона.");
    const triggers = Array.isArray(v.triggerChannelIds) ? v.triggerChannelIds.filter((id): id is string => typeof id === "string" && isSnowflake(id)).slice(0, 50) : [];
    if (!triggers.length) return jsonError("Выберите хотя бы один канал-триггер.");
    const input = fromTempPresetDto({ name, triggerChannelIds: triggers, config: parseConfig(v.config) });
    presets.push({ name: input.name, triggers: input.triggerChannelIds, config: input.config });
  }
  const existingRows = stmt.tempPresets.all(guildId);
  const canonical = (p: { name: string; triggers: string[]; config: TempChannelConfigDto }) => stableJson({ name: p.name, triggers: p.triggers.toSorted(), config: { categoryId: p.config.categoryId, nameTemplate: p.config.nameTemplate, userLimit: p.config.userLimit, canRename: +p.config.canRename, canManageAccess: +p.config.canManageAccess, canClose: +p.config.canClose } });
  const existing = existingRows.map(row => canonical({ name: row.name, triggers: parseStringArray(row.trigger_channel_ids_json), config: { categoryId: row.category_id, nameTemplate: row.name_template, userLimit: row.user_limit, canRename: Boolean(row.can_rename), canManageAccess: Boolean(row.can_manage_access), canClose: Boolean(row.can_close) } }));
  if (stableJson(existing) === stableJson(presets.map(canonical))) {
    return NextResponse.json({ ok: true, unchanged: true, presets: existingRows.map(toJson) });
  }
  const timestamp = Date.now();
  withTransaction(() => {
    tempchannelQueries.delete.run(guildId);
    for (const preset of presets) tempchannelQueries.insert.run(guildId, preset.name, JSON.stringify(preset.triggers), preset.config.categoryId, preset.config.nameTemplate, preset.config.userLimit, preset.config.canRename ? 1 : 0, preset.config.canManageAccess ? 1 : 0, preset.config.canClose ? 1 : 0, timestamp);
  });
  const existingByName = new Map(existingRows.map((row, index) => [row.name, existing[index]!]));
  const nextNames = new Set(presets.map(preset => preset.name));
  const added = presets.filter(preset => !existingByName.has(preset.name)).map(preset => `«${preset.name}»`);
  const removed = existingRows.filter(row => !nextNames.has(row.name)).map(row => `«${row.name}»`);
  const changed = presets.filter(preset => { const was = existingByName.get(preset.name); return was !== undefined && was !== canonical(preset); }).map(preset => `«${preset.name}»`);
  const parts = [added.length ? `добавлены ${added.join(", ")}` : "", removed.length ? `удалены ${removed.join(", ")}` : "", changed.length ? `изменены ${changed.join(", ")}` : ""].filter(Boolean);
  recordDashboardChange(guildId, user, AUDIT_SECTION.tempchannels, `Шаблоны: ${parts.join("; ")}`);
  return NextResponse.json({ ok: true, presets: stmt.tempPresets.all(guildId).map(toJson) });
});
