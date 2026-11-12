import { NextResponse } from "next/server.js";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { guildRoute, isSnowflake, jsonError } from "#lib/guild-access.ts";
import { welcomeQueries } from "#db/queries.ts";
import { fromDto, welcomeDefaults, type WelcomeDto } from "#contracts/welcome.ts";
import { MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS, parseImageConfig } from "#lib/welcome.ts";
import { normalizeWelcomeImage } from "#lib/welcome-render.ts";
import { deleteWelcomeBackgrounds, rejectOversized, WELCOME_IMAGE_EXTENSIONS, WELCOME_UPLOAD_PREFIX, welcomeUploadsDir } from "#lib/uploads.ts";
import { recordDashboardChange } from "#lib/dashboard-audit.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";
import { logger } from "#lib/logger.ts";
import { settingsGetRoute, settingsPutRoute } from "#lib/settings-route.ts";
import { welcomeState, welcomeView } from "#lib/settings-views.ts";
import { CHANNEL_TYPES, resourceError, validateResources } from "#lib/guild-resources.ts";

export const runtime = "nodejs";

export const GET = settingsGetRoute(guildId => welcomeState(guildId).state);

export const PUT = settingsPutRoute<WelcomeDto>({
  load: guildId => welcomeState(guildId),
  parse: body => {
    const value = body as Partial<WelcomeDto> | null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, response: jsonError("Некорректный запрос.") };
    if (typeof value.message !== "string" || typeof value.goodbyeMessage !== "string" || value.message.length > 2000 || value.goodbyeMessage.length > 2000) return { ok: false, response: jsonError("Текст сообщения не должен превышать 2000 символов.") };
    if (typeof value.enabled !== "boolean" || typeof value.goodbyeEnabled !== "boolean" || typeof value.imageEnabled !== "boolean") return { ok: false, response: jsonError("Некорректный запрос.") };
    if ((value.enabled && !value.channelId) || (value.goodbyeEnabled && !value.goodbyeChannelId)) return { ok: false, response: jsonError("Для включённого события выберите канал.") };
    if ((value.channelId && (typeof value.channelId !== "string" || !isSnowflake(value.channelId))) || (value.goodbyeChannelId && (typeof value.goodbyeChannelId !== "string" || !isSnowflake(value.goodbyeChannelId)))) {
      return { ok: false, response: jsonError("Некорректный канал.") };
    }
    const channelId = value.channelId || null, goodbyeChannelId = value.goodbyeChannelId || null;
    return {
      ok: true,
      value: {
        enabled: value.enabled,
        channelId,
        message: value.message,
        imageEnabled: value.imageEnabled,
        imageConfig: parseImageConfig(value.imageConfig),
        goodbyeEnabled: value.goodbyeEnabled,
        goodbyeChannelId,
        goodbyeMessage: value.goodbyeMessage,
        backgroundPath: null,
      },
    };
  },
  validate: async (guildId, value) => {
    const result = await validateResources(guildId, {
      channels: { ids: [value.channelId, value.goodbyeChannelId], types: CHANNEL_TYPES.text },
    });
    return result.ok ? null : resourceError(result);
  },
  view: welcomeView,
  save: (guildId, state) => {
    const row = fromDto(state);
    welcomeQueries.upsert.run({
      guild_id: guildId,
      enabled: row.enabled,
      channel_id: row.channel_id,
      message: row.message,
      image_enabled: row.image_enabled,
      image_config_json: row.image_config_json,
      goodbye_enabled: row.goodbye_enabled,
      goodbye_channel_id: row.goodbye_channel_id,
      goodbye_message: row.goodbye_message,
      updated_at: Date.now(),
    });
  },
  section: AUDIT_SECTION.welcome,
  prefix: "Приветствие: ",
  opaque: { "Настройки картинки": "изменены" },
  saveMissing: true,
});

export const DELETE = guildRoute(async (_request, { guildId, user }) => {
  const hadBackground = Boolean(welcomeState(guildId).state.backgroundPath);
  welcomeQueries.clearBackground.run(Date.now(), guildId);
  try {
    await deleteWelcomeBackgrounds(guildId);
  } catch (error) {
    logger.warn("[WELCOME] Не удалось удалить файлы фона", guildId, error);
  }
  if (hadBackground) recordDashboardChange(guildId, user, AUDIT_SECTION.welcome, "Удалён фон картинки приветствия.");
  return NextResponse.json({ ok: true, backgroundPath: null, removed: hadBackground });
});

export const POST = guildRoute(async (request, { guildId, user }) => {
  const oversized = rejectOversized(request, 6 * 1024 * 1024);
  if (oversized) return oversized;
  const form = await request.formData().catch(() => null);
  if (!form) return jsonError("Некорректный запрос.");
  const file = form.get("background");
  if (!(file instanceof File)) return jsonError("Выберите изображение");
  if (!WELCOME_IMAGE_EXTENSIONS[file.type] || file.size > 5 * 1024 * 1024) return jsonError("Допустимы PNG, JPG или WEBP до 5 МБ");
  let normalized;
  try {
    normalized = await normalizeWelcomeImage(Buffer.from(await file.arrayBuffer()), {
      maxDimension: MAX_IMAGE_DIMENSION,
      maxPixels: MAX_IMAGE_PIXELS,
      format: "jpeg",
      quality: 88,
    });
  } catch (error) {
    logger.warn("[WELCOME] Не удалось обработать фон", guildId, error);
    const unavailable = (error as { code?: string }).code === "NATIVE_LOAD";
    return jsonError(unavailable ? "Обработка изображений недоступна на сервере." : "Не удалось обработать изображение. Загрузите другой файл.", unavailable ? 503 : 400);
  }
  const dir = welcomeUploadsDir(); await mkdir(dir, { recursive: true });
  const ext = normalized.format === "jpeg" ? "jpg" : "png";
  const filename = `${guildId}-welcome.${ext}`, path = join(dir, filename), storedPath = `${WELCOME_UPLOAD_PREFIX}${filename}`;
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, normalized.data);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => null);
    logger.error("[WELCOME] Не удалось сохранить фон", guildId, error);
    return jsonError("Не удалось сохранить фон. Попробуйте ещё раз.", 500);
  }
  const welcomeInput = { ...welcomeDefaults, imageEnabled: true };
  welcomeQueries.backgroundUpsert.run({ ...fromDto(welcomeInput), guild_id: guildId, background_path: storedPath, updated_at: Date.now() });
  const saved = welcomeState(guildId).state;
  if (saved.backgroundPath !== storedPath || !saved.imageEnabled) {
    logger.error("[WELCOME] Не удалось сохранить фон в базе", guildId, { backgroundPath: saved.backgroundPath, imageEnabled: saved.imageEnabled });
    if (saved.backgroundPath !== storedPath) await unlink(path).catch(() => null);
    return jsonError("Не удалось сохранить фон. Попробуйте ещё раз.", 500);
  }
  await deleteWelcomeBackgrounds(guildId, filename).catch(error => logger.warn("[WELCOME] Не удалось удалить старый фон", guildId, error));
  recordDashboardChange(guildId, user, AUDIT_SECTION.welcome, "Загружен новый фон картинки приветствия.");
  return NextResponse.json({ ok: true, backgroundPath: storedPath, imageEnabled: true });
});
