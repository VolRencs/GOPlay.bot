import { safeJson } from "../json.ts";
import { normalizeEmbedContent, parseEmbedJson, toDiscordEmbed } from "../../contracts/embeds.ts";
import { eventStatusMetaM } from "../labels.ts";
import type { Locale } from "../i18n/core.ts";
import { eventsTr, trFor } from "../i18n/bot.ts";
import {
  MAX_REMINDER_MINUTES, eventButtonStyles, recurrenceFrequencies,
  type EventButton, type EventCounts, type EventEmbed, type EventEmbedPayload,
  type EventRecurrence, type EventRow, type RenderableEvent, type RenderedEventButton,
} from "./types.ts";

export function parseEventEmbed(raw: string | null | undefined): EventEmbed {
  return parseEmbedJson(raw);
}
export function parseEventButtons(raw: string | null | undefined): EventButton[] {
  const parsed = safeJson<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((b): b is EventButton => {
    if (!b || typeof b !== "object") return false;
    const key = (b as EventButton).key;
    return key === "join" || key === "leave";
  });
}
export function sanitizeReminders(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is number => Number.isInteger(v) && v > 0 && v <= MAX_REMINDER_MINUTES))].slice(0, 10) : [];
}
export function parseEventReminders(raw: string | null | undefined): number[] {
  return sanitizeReminders(safeJson<unknown>(raw, []));
}
export function parseEventRecurrence(raw: string | null | undefined): EventRecurrence {
  const parsed = safeJson<{ freq?: unknown; interval?: unknown }>(raw, {});
  const freq = recurrenceFrequencies.find(value => value === parsed.freq) ?? "none";
  const interval = Number.isInteger(parsed.interval) ? Math.max(1, Math.min(365, parsed.interval as number)) : 1;
  return { freq, interval };
}

export function renderableOf(row: EventRow): RenderableEvent {
  return { status: row.status, scheduledAt: row.scheduled_at, maxParticipants: row.max_participants, registrationEnabled: Boolean(row.registration_enabled), waitlistEnabled: Boolean(row.waitlist_enabled) };
}

export function renderEventEmbed(lang: Locale, event: RenderableEvent, embed: EventEmbed, counts: EventCounts): EventEmbedPayload {
  const tr = trFor(eventsTr, lang);
  const userFields: { name: string; value: string; inline: boolean }[] = (embed.fields ?? []).map(f => ({ name: f.name, value: f.value, inline: Boolean(f.inline) }));
  const added: typeof userFields = [];
  if (embed.timestamp) {
    const unix = Math.floor(event.scheduledAt / 1000);
    added.push({ name: tr("fldDate"), value: `<t:${unix}:d> (<t:${unix}:R>)`, inline: true });
  }
  if (event.status !== "scheduled") added.push({ name: tr("fldStatus"), value: eventStatusMetaM[event.status]?.label[lang] ?? event.status, inline: true });
  if (event.registrationEnabled || counts.joined > 0) added.push({ name: tr("fldParticipants"), value: event.maxParticipants > 0 ? tr("joinedOf", { a: String(counts.joined), b: String(event.maxParticipants) }) : String(counts.joined), inline: true });
  if (counts.waitlist > 0) added.push({ name: tr("fldWaitlist"), value: String(counts.waitlist), inline: true });
  const fields = [...userFields.slice(0, Math.max(0, 25 - added.length)), ...added];
  return toDiscordEmbed({
    ...(embed.title ? { title: embed.title } : {}),
    ...(embed.description ? { description: embed.description } : {}),
    ...(Number.isInteger(embed.color) ? { color: embed.color } : {}),
    ...(embed.footer?.text ? { footer: { text: embed.footer.text } } : {}),
    ...(embed.author?.name ? { author: embed.author } : {}),
    ...(embed.thumbnail?.url ? { thumbnail: { url: embed.thumbnail.url } } : {}),
    ...(embed.image?.url ? { image: { url: embed.image.url } } : {}),
    ...(fields.length ? { fields } : {}),
  });
}

export function renderEventButtons(event: RenderableEvent, buttons: EventButton[], counts: EventCounts): RenderedEventButton[] {
  const closed = event.status !== "scheduled" && event.status !== "live";
  const limitReached = event.maxParticipants > 0 && counts.joined >= event.maxParticipants;
  return buttons
    .sort((a, b) => a.order - b.order)
    .map(b => ({ ...b, disabled: !b.enabled || (b.key === "join" ? event.status !== "scheduled" || !event.registrationEnabled || (limitReached && !event.waitlistEnabled) : closed) }));
}

export function cleanEmbed(value: unknown): EventEmbed {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  return { ...normalizeEmbedContent(v).content, timestamp: v.timestamp === true };
}

export function cleanButtons(value: unknown): EventButton[] {
  const raw = Array.isArray(value) ? value : [];
  const defaults: Record<"join" | "leave", EventButton> = {
    join: { key: "join", label: "Участвовать", emoji: "✅", style: "primary", enabled: true, order: 1 },
    leave: { key: "leave", label: "Отказаться", emoji: "❌", style: "danger", enabled: true, order: 2 },
  };
  const result = new Map<string, EventButton>();
  for (const entry of raw.slice(0, 10)) {
    const v = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const key = v.key === "join" || v.key === "leave" ? v.key : null;
    if (!key) continue;
    const fallback = defaults[key];
    const label = (typeof v.label === "string" ? v.label.trim() : "") || fallback.label;
    const style: EventButton["style"] = eventButtonStyles.find(value => value === v.style) ?? fallback.style;
    const order = Number.isInteger(v.order) ? Math.max(1, Math.min(2, Number(v.order))) : fallback.order;
    result.set(key, { key, label: label.slice(0, 80), emoji: (typeof v.emoji === "string" ? v.emoji.trim() : "").slice(0, 64), style, enabled: v.enabled !== false, order });
  }
  return [result.get("join") ?? defaults.join, result.get("leave") ?? defaults.leave];
}
