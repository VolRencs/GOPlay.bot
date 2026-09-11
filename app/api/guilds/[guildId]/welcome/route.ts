import { NextResponse } from "next/server.js";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { guildRoute, isSnowflake, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
import { db } from "../../../../../src/db/database.ts";
import { parseImageConfig, welcomeDefaults, type WelcomeGet, type WelcomePutBody } from "../../../../../src/lib/welcome.ts";
import { stableJson } from "../../../../../src/lib/json.ts";
import { rejectOversized } from "../../../../../src/lib/uploads.ts";
import { stmt } from "../../../../../src/bot/db/statements.ts";
import { recordDashboardChange, recordDashboardDiff } from "../../../../../src/lib/dashboard-audit.ts";

// Statements готовятся один раз на модуль: SQL статический, параметры через `?`.
const welcomeUpsert = db.prepare(`INSERT INTO welcome_settings(guild_id,enabled,channel_id,message,image_enabled,image_config_json,goodbye_enabled,goodbye_channel_id,goodbye_message,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled,channel_id=excluded.channel_id,message=excluded.message,image_enabled=excluded.image_enabled,image_config_json=excluded.image_config_json,goodbye_enabled=excluded.goodbye_enabled,goodbye_channel_id=excluded.goodbye_channel_id,goodbye_message=excluded.goodbye_message,updated_at=excluded.updated_at`);
const welcomeBackgroundUpsert = db.prepare("INSERT INTO welcome_settings(guild_id,background_path,updated_at) VALUES(?,?,?) ON CONFLICT(guild_id) DO UPDATE SET background_path=excluded.background_path,updated_at=excluded.updated_at");

export const GET = guildRoute(async (_, { guildId }) => {
  const saved = stmt.welcomeSettings.get(guildId) as WelcomeGet | undefined;
  return NextResponse.json<WelcomeGet>({ ...welcomeDefaults, ...saved });
});

export const PUT = guildRoute(async (request, { guildId, user }) => {
  const value = await readJson<WelcomePutBody>(request);
  if (!value || typeof value !== "object") return jsonError("Некорректный запрос.");
  if (typeof value.message !== "string" || typeof value.goodbyeMessage !== "string" || value.message.length > 2000 || value.goodbyeMessage.length > 2000) return jsonError("Текст сообщения не должен превышать 2000 символов.");
  if ((value.enabled && !value.channelId) || (value.goodbyeEnabled && !value.goodbyeChannelId)) return jsonError("Для включённого события выберите канал.");
  if ((value.channelId && !isSnowflake(value.channelId)) || (value.goodbyeChannelId && !isSnowflake(value.goodbyeChannelId))) return jsonError("Некорректный канал.");
  const saved = stmt.welcomeSettings.get(guildId) as Record<string, unknown> | undefined;
  const nextImageConfig = parseImageConfig(value.imageConfig);
  const currentImageConfig = parseImageConfig(saved?.image_config_json);
  const next = stableJson({ enabled: Number(Boolean(value.enabled)), channelId: value.channelId ?? null, message: value.message, imageEnabled: Number(Boolean(value.imageEnabled)), imageConfig: nextImageConfig, goodbyeEnabled: Number(Boolean(value.goodbyeEnabled)), goodbyeChannelId: value.goodbyeChannelId ?? null, goodbyeMessage: value.goodbyeMessage });
  const current = saved ? stableJson({ enabled: Number(saved.enabled), channelId: saved.channel_id ?? null, message: saved.message, imageEnabled: Number(saved.image_enabled), imageConfig: currentImageConfig, goodbyeEnabled: Number(saved.goodbye_enabled), goodbyeChannelId: saved.goodbye_channel_id ?? null, goodbyeMessage: saved.goodbye_message }) : null;
  if (current === next) return NextResponse.json({ ok: true, unchanged: true });
  const welcomeConfig = JSON.stringify(nextImageConfig);
  welcomeUpsert.run(guildId, Number(Boolean(value.enabled)), value.channelId, value.message, Number(Boolean(value.imageEnabled)), welcomeConfig, Number(Boolean(value.goodbyeEnabled)), value.goodbyeChannelId, value.goodbyeMessage, Date.now());
  const src: Record<string, unknown> = saved ?? welcomeDefaults;
  recordDashboardDiff(guildId, user, "Приветствие", "Приветствие: ",
    {
      "Режим приветствия": Boolean(src.enabled),
      "Канал приветствия": src.channel_id ? `<#${String(src.channel_id)}>` : null,
      "Текст приветствия": String(src.message),
      "Персональная картинка": Boolean(src.image_enabled),
      "Настройки картинки": stableJson(currentImageConfig),
      "Режим прощания": Boolean(src.goodbye_enabled),
      "Канал прощания": src.goodbye_channel_id ? `<#${String(src.goodbye_channel_id)}>` : null,
      "Текст прощания": String(src.goodbye_message),
    },
    {
      "Режим приветствия": Boolean(value.enabled),
      "Канал приветствия": value.channelId ? `<#${value.channelId}>` : null,
      "Текст приветствия": value.message,
      "Персональная картинка": Boolean(value.imageEnabled),
      "Настройки картинки": stableJson(nextImageConfig),
      "Режим прощания": Boolean(value.goodbyeEnabled),
      "Канал прощания": value.goodbyeChannelId ? `<#${value.goodbyeChannelId}>` : null,
      "Текст прощания": value.goodbyeMessage,
    },
    { "Настройки картинки": "изменены" });
  return NextResponse.json({ ok: true });
});

export const POST = guildRoute(async (request, { guildId, user }) => {
  const oversized = rejectOversized(request);
  if (oversized) return oversized;
  const form = await request.formData(), file = form.get("background");
  if (!(file instanceof File)) return jsonError("Выберите изображение");
  const ext: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  if (!ext[file.type] || file.size > 5 * 1024 * 1024) return jsonError("Допустимы PNG, JPG или WEBP до 5 МБ");
  const dir = join(process.cwd(), "public", "uploads", "welcome"); await mkdir(dir, { recursive: true });
  const filename = `${guildId}-welcome.${ext[file.type]}`, path = join(dir, filename), publicPath = `/uploads/welcome/${filename}`;
  for (const name of await readdir(dir).catch(() => [] as string[])) if (name.startsWith(`${guildId}-welcome.`) && name !== filename) await unlink(join(dir, name)).catch(() => null);
  await writeFile(path, Buffer.from(await file.arrayBuffer()));
  welcomeBackgroundUpsert.run(guildId, publicPath, Date.now());
  recordDashboardChange(guildId, user, "Приветствие", "Загружен новый фон картинки приветствия.");
  return NextResponse.json({ ok: true, backgroundPath: publicPath });
});
