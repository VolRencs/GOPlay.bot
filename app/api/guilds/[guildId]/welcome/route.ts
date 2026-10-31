import { NextResponse } from "next/server.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { guildRoute, isSnowflake, jsonError } from "#lib/guild-access.ts";
import { welcomeQueries } from "#db/queries.ts";
import { fromDto, welcomeDefaults, type WelcomeDto } from "#contracts/welcome.ts";
import { parseImageConfig } from "#lib/welcome.ts";
import { deleteWelcomeBackgrounds, rejectOversized, WELCOME_IMAGE_EXTENSIONS, WELCOME_UPLOAD_PREFIX, welcomeUploadsDir } from "#lib/uploads.ts";
import { recordDashboardChange } from "#lib/dashboard-audit.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";
import { settingsPutRoute } from "#lib/settings-route.ts";
import { welcomeState, welcomeView } from "#lib/settings-views.ts";

export const GET = guildRoute(async (_, { guildId }) => {
  return NextResponse.json<WelcomeDto>(welcomeState(guildId).state);
});

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
    // Пустая строка — «канал не выбран»: без нормализации в БД попадал "" и
    // сравнение с null не срабатывало (лишний upsert + мусор в channel_id).
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

export const POST = guildRoute(async (request, { guildId, user }) => {
  const oversized = rejectOversized(request);
  if (oversized) return oversized;
  const form = await request.formData(), file = form.get("background");
  if (!(file instanceof File)) return jsonError("Выберите изображение");
  const ext = WELCOME_IMAGE_EXTENSIONS[file.type];
  if (!ext || file.size > 5 * 1024 * 1024) return jsonError("Допустимы PNG, JPG или WEBP до 5 МБ");
  const dir = welcomeUploadsDir(); await mkdir(dir, { recursive: true });
  const filename = `${guildId}-welcome.${ext}`, path = join(dir, filename), publicPath = `${WELCOME_UPLOAD_PREFIX}${filename}`;
  await deleteWelcomeBackgrounds(guildId, filename);
  await writeFile(path, Buffer.from(await file.arrayBuffer()));
  const welcomeInput = { ...welcomeDefaults };
  welcomeQueries.backgroundUpsert.run({ ...fromDto(welcomeInput), guild_id: guildId, background_path: publicPath, updated_at: Date.now() });
  recordDashboardChange(guildId, user, AUDIT_SECTION.welcome, "Загружен новый фон картинки приветствия.");
  return NextResponse.json({ ok: true, backgroundPath: publicPath });
});
