import { after, NextResponse } from "next/server.js";
import { discordFetch, guildMemberNames, guildRoute, isSnowflake, jsonError } from "#lib/guild-access.ts";
import { recordDashboardChange, recordDashboardDiff } from "#lib/dashboard-audit.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";
import { channelRef, roleRef, userRef } from "#lib/mentions.ts";
import { formatTime } from "#lib/format.ts";
import { safeJson, stableJson } from "#lib/json.ts";
import { eventStatusMetaM } from "#lib/labels.ts";
import { guildLang } from "#lib/i18n/bot.ts";
import { BOT_TOKEN_ERROR, buttonStyleId } from "#lib/constants.ts";
import { eventQueries } from "#db/queries.ts";
import { cleanupUnusedUploads, eventUploadPrefix, eventUploadsDir, extractFilenames, rejectOversized } from "#lib/uploads.ts";
import { AssetError, collectNewUploads, persistUploadedAssets, reattachStoredAssets, type StoredAsset } from "#lib/assets.ts";
import { applyEventRole, clampEventInput, deleteEvent, eventCounts, getEventInGuild, insertEvent, listEvents, parseEventButtons, parseEventEmbed, removeParticipant, renderEventButtons, renderEventEmbed, renderableOf, updateEvent, type EventButton, type EventEmbedPayload, type EventRow, type RenderableEvent, type RenderedEventButton } from "#lib/events.ts";
import type { EventListDto } from "#contracts/events.ts";

type EventImageTarget = "thumbnail" | "image";

const buttonLabel = (b: EventButton & { disabled: boolean }) => `${b.emoji ? `${b.emoji} ` : ""}${b.label}`.trim();

function eventImageNames(embedJson: string, guildId: string) {
  const embed = parseEventEmbed(embedJson);
  return extractFilenames(eventUploadPrefix(guildId), [embed.thumbnail?.url, embed.image?.url]);
}

async function cleanupUnusedEventImages(guildId: string) {
  await cleanupUnusedUploads(eventUploadsDir(guildId), eventQueries.embeds.all(guildId), row => eventImageNames(row.embed_json, guildId), 60 * 60_000);
}

type SendResult = { id: string } | { status: number };
async function sendOrEdit(channelId: string, messageId: string | null, embed: EventEmbedPayload, buttons: RenderedEventButton[], eventId: string, files: readonly StoredAsset<EventImageTarget>[]): Promise<SendResult> {
  const components = buttons.length ? [{ type: 1, components: buttons.map(b => ({ type: 2, style: buttonStyleId(b.style), label: buttonLabel(b), custom_id: `event:${b.key}:${eventId}`, disabled: Boolean(b.disabled) })) }] : [];
  // Панель публикует от имени бота: упоминания в заголовке/описании не должны пинговать никого.
  const bodyData = { embeds: [embed], components, allowed_mentions: { parse: [] } };
  let body: BodyInit = JSON.stringify(bodyData);
  let headers: Record<string, string> = { "content-type": "application/json" };
  if (files.length) {
    const multipart = new FormData();
    multipart.set("payload_json", JSON.stringify(bodyData));
    files.forEach((asset, index) => multipart.append(`files[${index}]`, asset.file, asset.filename));
    body = multipart;
    headers = {};
  }
  try {
    const response = await discordFetch(`/channels/${channelId}/messages${messageId ? `/${messageId}` : ""}`, { method: messageId ? "PATCH" : "POST", headers, body });
    if (!response.ok) return { status: response.status };
    return await response.json() as { id: string };
  } catch {
    return { status: 0 };
  }
}

async function syncDiscord(current: EventRow, channelId: string, embed: EventEmbedPayload, buttons: RenderedEventButton[], files: readonly StoredAsset<EventImageTarget>[]): Promise<{ messageId: string | null; warning: string | null }> {
  if (!current.message_id || current.channel_id !== channelId) {
    if (current.message_id) await discordFetch(`/channels/${current.channel_id}/messages/${current.message_id}`, { method: "DELETE" }).catch(() => null);
    const sent = await sendOrEdit(channelId, null, embed, buttons, current.id, files);
    if ("id" in sent) return { messageId: sent.id, warning: null };
    return { messageId: null, warning: "Не удалось отправить сообщение события в канал." };
  }
  const patched = await sendOrEdit(channelId, current.message_id, embed, buttons, current.id, files);
  if ("id" in patched) return { messageId: patched.id, warning: null };
  if (patched.status !== 404) return { messageId: current.message_id, warning: "Не удалось обновить сообщение события — попробуйте ещё раз." };
  const resent = await sendOrEdit(channelId, null, embed, buttons, current.id, files);
  if ("id" in resent) return { messageId: resent.id, warning: null };
  return { messageId: null, warning: "Не удалось восстановить сообщение события." };
}

export const GET = guildRoute(async (_, { guildId }) => {
  const names = await guildMemberNames(guildId).catch(() => new Map<string, string>());
  return NextResponse.json<EventListDto>({ events: listEvents(guildId).map(view => ({ ...view, participants: view.participants.map(p => ({ ...p, name: names.get(p.userId) ?? null })) })) });
});

export const POST = guildRoute(async (request, { guildId, user }) => {
  const lang = guildLang(guildId);
  const oversized = rejectOversized(request);
  if (oversized) return oversized;
  const form = request.headers.get("content-type")?.includes("multipart/form-data") ? await request.formData() : null;
  let data: Record<string, unknown>;
  try {
    const serialized = form?.get("data");
    data = (form ? JSON.parse(typeof serialized === "string" ? serialized : "{}") : await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("Не удалось прочитать данные события.");
  }
  const input = clampEventInput(data);
  if ("error" in input) return jsonError(input.error);
  const id = typeof data.id === "string" && data.id.length ? data.id : null;
  const current = id ? getEventInGuild(guildId, id) : undefined;
  if (id && !current) return jsonError("Событие не найдено.", 404);
  const token = process.env.DISCORD_TOKEN;
  if (!token) return jsonError(BOT_TOKEN_ERROR, 503);

  const embed = input.embed;
  const setAsset = (target: EventImageTarget, url: string) => { if (target === "thumbnail") embed.thumbnail = { url }; else embed.image = { url }; };
  const fieldUrl = (target: EventImageTarget) => target === "thumbnail" ? embed.thumbnail?.url : embed.image?.url;
  let assets: StoredAsset<EventImageTarget>[];
  let originals: { target: EventImageTarget; url: string }[];
  try {
    assets = await collectNewUploads<EventImageTarget>(form, [{ formKey: "thumbnailFile", target: "thumbnail" }, { formKey: "imageFile", target: "image" }], setAsset);
    // Переотправка сохранённых локальных картинок — правка их не ломает.
    const stored = await reattachStoredAssets<EventImageTarget>({
      targets: ["thumbnail", "image"],
      urlOf: fieldUrl,
      skipTargets: assets.map(asset => asset.target),
      prefix: eventUploadPrefix(guildId),
      dir: eventUploadsDir(guildId),
      setAsset,
    });
    assets = [...assets, ...stored.assets];
    originals = stored.originals;
  } catch (error) {
    if (!(error instanceof AssetError)) throw error;
    return jsonError(error.message);
  }
  const persistAssets = async () => persistUploadedAssets(eventUploadsDir(guildId), eventUploadPrefix(guildId), assets, originals, setAsset);

  let saved: EventRow;
  let messageId: string | null;
  let warning: string | null = null;
  const counts = current ? eventCounts(current.id) : { joined: 0, waitlist: 0 };
  const renderable: RenderableEvent = { status: input.status, scheduledAt: input.scheduledAt, maxParticipants: input.maxParticipants, registrationEnabled: input.registrationEnabled, waitlistEnabled: input.waitlistEnabled };
  const rendered = renderEventEmbed(lang, renderable, embed, counts);
  const buttons = renderEventButtons(renderable, input.buttons, counts);
  if (current) {
    const sync = await syncDiscord(current, input.channelId, rendered, buttons, assets);
    warning = sync.warning;
    saved = current;
    messageId = sync.messageId;
  } else {
    // Сообщение шлётся после создания строки: custom_id кнопок содержит реальный
    // id события; неудачная отправка откатывает событие целиком.
    saved = insertEvent(guildId, { ...input, id: crypto.randomUUID(), messageId: null });
    const sent = await sendOrEdit(input.channelId, null, rendered, buttons, saved.id, assets);
    if (!("id" in sent)) { deleteEvent(guildId, saved.id); return jsonError("Не удалось отправить сообщение в выбранный канал.", 502); }
    messageId = sent.id;
  }
  await persistAssets();
  // Параллельное удаление другим модератором → 409 вместо TypeError по пустой строке.
  const updated = updateEvent(guildId, saved.id, { ...input, messageId });
  if (!updated) return jsonError("Событие было удалено во время сохранения.", 409);
  saved = updated;
  after(() => cleanupUnusedEventImages(guildId));
  const title = embed.title ?? "без названия";
  if (current) {
    const statusLabel = (status: string) => eventStatusMetaM[status]?.label.ru ?? status;
    recordDashboardDiff(guildId, user, AUDIT_SECTION.events, `Событие «${title}»: `,
      {
        "Время": formatTime(current.scheduled_at),
        "Канал": channelRef(current.channel_id),
        "Статус": statusLabel(current.status),
        "Лимит участников": current.max_participants > 0 ? current.max_participants : "без лимита",
        "Регистрация": Boolean(current.registration_enabled),
        "Очередь ожидания": Boolean(current.waitlist_enabled),
        "Роль события": current.event_role_id ? roleRef(current.event_role_id) : null,
        "Напоминания": safeJson<number[]>(current.reminders_json, []).map(minutes => `${minutes} мин`),
        "Повтор": stableJson(safeJson<unknown>(current.recurrence_json, {})),
        "Сообщение": stableJson(parseEventEmbed(current.embed_json)),
        "Кнопки": stableJson(parseEventButtons(current.buttons_json)),
      },
      {
        "Время": formatTime(input.scheduledAt),
        "Канал": channelRef(input.channelId),
        "Статус": statusLabel(input.status),
        "Лимит участников": input.maxParticipants > 0 ? input.maxParticipants : "без лимита",
        "Регистрация": input.registrationEnabled,
        "Очередь ожидания": input.waitlistEnabled,
        "Роль события": input.eventRoleId ? roleRef(input.eventRoleId) : null,
        "Напоминания": input.reminders.map(minutes => `${minutes} мин`),
        "Повтор": stableJson(input.recurrence),
        "Сообщение": stableJson(input.embed),
        "Кнопки": stableJson(input.buttons),
      },
      { "Повтор": "изменён", "Сообщение": "изменено", "Кнопки": "изменены" });
  } else {
    recordDashboardChange(guildId, user, AUDIT_SECTION.events, `Создано событие «${title}»`);
  }
  return NextResponse.json({ ok: true, id: saved.id, messageId: saved.message_id, ...(warning ? { warning } : {}) });
});

export const DELETE = guildRoute(async (request, { guildId, user }) => {
  const lang = guildLang(guildId);
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const participant = url.searchParams.get("participant");
  const token = process.env.DISCORD_TOKEN;
  if (participant) {
    if (!isSnowflake(participant)) return jsonError("Некорректный ID участника.");
    const result = removeParticipant(id, participant, guildId);
    if (!result) return jsonError("Событие или участник не найдены.", 404);
    const event = getEventInGuild(guildId, id);
    if (event?.event_role_id) {
      await applyEventRole(guildId, participant, event.event_role_id, false);
      if (result.promotedUserId) await applyEventRole(guildId, result.promotedUserId, event.event_role_id, true);
    }
    if (token && event) {
      const counts = eventCounts(event.id);
      const embed = renderEventEmbed(lang, renderableOf(event), parseEventEmbed(event.embed_json), counts);
      const buttons = renderEventButtons(renderableOf(event), parseEventButtons(event.buttons_json), counts);
      await syncDiscord(event, event.channel_id, embed, buttons, []);
    }
    recordDashboardChange(guildId, user, AUDIT_SECTION.events, `Участник ${userRef(participant)} удалён из события${result.promotedUserId ? `, ${userRef(result.promotedUserId)} переведён из очереди` : ""}`);
    return NextResponse.json({ ok: true, promotedUserId: result.promotedUserId });
  }
  const removed = deleteEvent(guildId, id);
  if (!removed) return jsonError("Событие не найдено.", 404);
  if (token && removed.messageId) await discordFetch(`/channels/${removed.channelId}/messages/${removed.messageId}`, { method: "DELETE" }).catch(() => null);
  after(() => cleanupUnusedEventImages(guildId));
  recordDashboardChange(guildId, user, AUDIT_SECTION.events, `Событие «${removed.embed.title ?? "без названия"}» удалено`);
  return NextResponse.json({ ok: true });
});
