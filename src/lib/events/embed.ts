import { safeJson } from "../json.ts";
import { eventStatusMetaM } from "../labels.ts";
import type { Locale } from "../i18n/core.ts";
import { eventsTr, trFor } from "../i18n/bot.ts";
import {
  MAX_REMINDER_MINUTES, eventButtonStyles, recurrenceFrequencies,
  type EventButton, type EventCounts, type EventEmbed, type EventEmbedPayload,
  type EventRecurrence, type EventRow, type RenderableEvent, type RenderedEventButton,
} from "./types.ts";

export function parseEventEmbed(raw: string | null | undefined): EventEmbed {
  const parsed = safeJson<unknown>(raw, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as EventEmbed : {};
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
  return {
    ...(embed.title ? { title: embed.title } : {}),
    ...(embed.description ? { description: embed.description } : {}),
    ...(Number.isInteger(embed.color) ? { color: embed.color } : {}),
    ...(embed.footer?.text ? { footer: { text: embed.footer.text } } : {}),
    ...(embed.thumbnail?.url ? { thumbnail: { url: embed.thumbnail.url } } : {}),
    ...(embed.image?.url ? { image: { url: embed.image.url } } : {}),
    ...(fields.length ? { fields } : {}),
  };
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
  const text = (s: unknown): string | undefined => {
    if (typeof s === "string") return s.trim() || undefined;
    if (s && typeof s === "object") {
      const entry = s as Record<string, unknown>;
      return typeof entry.text === "string" ? entry.text.trim() || undefined : typeof entry.url === "string" ? entry.url.trim() || undefined : undefined;
    }
    return undefined;
  };
  const fields = Array.isArray(v.fields) ? v.fields.slice(0, 25).map((raw) => {
    const field = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return { name: (typeof field.name === "string" ? field.name : "").trim().slice(0, 256), value: (typeof field.value === "string" ? field.value : "").trim().slice(0, 1024), inline: Boolean(field.inline) };
  }).filter(f => f.name && f.value) : [];
  const title = text(v.title)?.slice(0, 256), description = text(v.description)?.slice(0, 4096);
  const footer = text(v.footer)?.slice(0, 2048), thumbnail = text(v.thumbnail)?.slice(0, 2048), image = text(v.image)?.slice(0, 2048);
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(Number.isInteger(v.color) ? { color: v.color as number } : {}),
    ...(footer ? { footer: { text: footer } } : {}),
    ...(thumbnail ? { thumbnail: { url: thumbnail } } : {}),
    ...(image ? { image: { url: image } } : {}),
    ...(fields.length ? { fields } : {}),
    timestamp: v.timestamp === true,
  };
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
