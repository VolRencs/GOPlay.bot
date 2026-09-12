import { db, withTransaction } from "../db/database.ts";
import { DAY_MS, clampNumber } from "./constants.ts";
import { discordFetch, isSnowflake, sendDiscordDM } from "./guild-access.ts";
import { stmt } from "../bot/db/statements.ts";
import { safeJson } from "./json.ts";
import { eventStatusMetaM } from "./labels.ts";
import { logger } from "../bot/utils/logger.ts";
import type { Locale } from "./i18n/core.ts";
import { eventsTr, guildLang } from "./i18n/bot.ts";

const eventStatuses = ["scheduled", "live", "completed", "cancelled"] as const;
export type EventStatus = (typeof eventStatuses)[number];
const eventButtonStyles = ["primary", "secondary", "success", "danger"] as const;
export type EventButtonStyle = (typeof eventButtonStyles)[number];
const recurrenceFrequencies = ["none", "daily", "weekly", "biweekly", "custom"] as const;
export type RecurrenceFrequency = (typeof recurrenceFrequencies)[number];

// Форма embed'а совпадает с тем, что уходит в Discord API: композер панели
// показывает ровно то, что будет опубликовано.
type EventEmbed = {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text?: string };
  thumbnail?: { url?: string };
  image?: { url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  timestamp?: boolean;
};
export type EventEmbedPayload = Omit<EventEmbed, "timestamp" | "footer" | "thumbnail" | "image"> & { footer?: { text: string }; thumbnail?: { url: string }; image?: { url: string } };
export type EventButton = { key: "join" | "leave"; label: string; emoji: string; style: EventButtonStyle; enabled: boolean; order: number };
type EventRecurrence = { freq: RecurrenceFrequency; interval: number };

export type EventRow = {
  id: string; guild_id: string; channel_id: string; message_id: string | null;
  series_id: string | null; embed_json: string; buttons_json: string;
  scheduled_at: number; max_participants: number;
  registration_enabled: number; waitlist_enabled: number; status: EventStatus;
  event_role_id: string | null; reminders_json: string; recurrence_json: string;
  created_at: number; updated_at: number; started_at: number | null;
  completed_at: number | null; cancelled_at: number | null; stats_json: string | null;
};
type ParticipantRow = { event_id: string; user_id: string; joined_at: number; waitlist: number };
type EventCounts = { joined: number; waitlist: number };

const MAX_REMINDER_MINUTES = 525_600;
const MAX_PARTICIPANTS_LIMIT = 100_000;

const eventGet = db.prepare("SELECT * FROM events WHERE id=?");
const eventGetInGuild = db.prepare("SELECT * FROM events WHERE id=? AND guild_id=?");
const eventInsert = db.prepare(`INSERT INTO events(id,guild_id,channel_id,message_id,series_id,embed_json,buttons_json,scheduled_at,max_participants,registration_enabled,waitlist_enabled,status,event_role_id,reminders_json,recurrence_json,created_at,updated_at,started_at,completed_at,cancelled_at,stats_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
const eventUpdate = db.prepare(`UPDATE events SET channel_id=?,message_id=?,embed_json=?,buttons_json=?,scheduled_at=?,max_participants=?,registration_enabled=?,waitlist_enabled=?,status=?,event_role_id=?,reminders_json=?,recurrence_json=?,updated_at=?,started_at=?,completed_at=?,cancelled_at=?,stats_json=? WHERE id=? AND guild_id=?`);
const eventDelete = db.prepare("DELETE FROM events WHERE id=? AND guild_id=?");
const eventDeleteByGuild = db.prepare("DELETE FROM events WHERE guild_id=?");
const eventUpdateMessage = db.prepare("UPDATE events SET message_id=?,updated_at=? WHERE id=?");
const eventDetachByMessage = db.prepare("UPDATE events SET message_id=NULL,updated_at=? WHERE message_id=?");
const eventList = db.prepare("SELECT * FROM events WHERE guild_id=? ORDER BY scheduled_at DESC");
const eventsDueLive = db.prepare("SELECT * FROM events WHERE status='scheduled' AND scheduled_at<=?");
const eventsOfUserInGuild = db.prepare("SELECT p.event_id FROM event_participants p JOIN events e ON e.id=p.event_id WHERE e.guild_id=? AND p.user_id=?");
const nextInSeries = db.prepare("SELECT id FROM events WHERE series_id=? AND status='scheduled' LIMIT 1");

const participantGet = db.prepare("SELECT * FROM event_participants WHERE event_id=? AND user_id=?");
const participantInsert = db.prepare("INSERT INTO event_participants(event_id,user_id,joined_at,waitlist) VALUES(?,?,?,?)");
const participantDelete = db.prepare("DELETE FROM event_participants WHERE event_id=? AND user_id=?");
const participantPromote = db.prepare("UPDATE event_participants SET waitlist=0 WHERE event_id=? AND user_id=? AND waitlist=1");
const participantsOf = db.prepare("SELECT * FROM event_participants WHERE event_id=? ORDER BY waitlist, joined_at");
// Один агрегат вместо двух COUNT: joined/waitlist считаются одним проходом по индексу.
const eventCountsStmt = db.prepare("SELECT COALESCE(SUM(waitlist=0),0) AS joined, COALESCE(SUM(waitlist=1),0) AS waitlist FROM event_participants WHERE event_id=?");
const nextWaitlistedStmt = db.prepare("SELECT user_id FROM event_participants WHERE event_id=? AND waitlist=1 ORDER BY joined_at LIMIT 1");

const reminderDeleteUnsent = db.prepare("DELETE FROM event_reminders WHERE event_id=? AND sent_at IS NULL");
const reminderInsert = db.prepare("INSERT OR IGNORE INTO event_reminders(event_id,due_at) VALUES(?,?)");
const reminderClaim = db.prepare("UPDATE event_reminders SET sent_at=? WHERE id=? AND sent_at IS NULL");
const remindersDue = db.prepare("SELECT id,event_id FROM event_reminders WHERE due_at<=? AND sent_at IS NULL");

// Агрегаты для списка событий гильдии: один GROUP BY вместо двух COUNT на
// каждое событие, участники одним запросом (иначе вкладка «События» давала N+1).
const countsByGuildStmt = db.prepare(
  "SELECT p.event_id AS eventId, SUM(p.waitlist=0) AS joined, SUM(p.waitlist=1) AS waitlist FROM event_participants p JOIN events e ON e.id=p.event_id WHERE e.guild_id=? GROUP BY p.event_id",
);
const participantsByGuildStmt = db.prepare(
  "SELECT p.event_id AS eventId, p.user_id AS userId, p.joined_at AS joinedAt, p.waitlist FROM event_participants p JOIN events e ON e.id=p.event_id WHERE e.guild_id=? ORDER BY p.waitlist, p.joined_at",
);

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
function sanitizeReminders(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is number => Number.isInteger(v) && v > 0 && v <= MAX_REMINDER_MINUTES))].slice(0, 10) : [];
}
function parseEventReminders(raw: string | null | undefined): number[] {
  return sanitizeReminders(safeJson<unknown>(raw, []));
}
function parseEventRecurrence(raw: string | null | undefined): EventRecurrence {
  const parsed = safeJson<{ freq?: unknown; interval?: unknown }>(raw, {});
  const freq = recurrenceFrequencies.find(value => value === parsed.freq) ?? "none";
  const interval = Number.isInteger(parsed.interval) ? Math.max(1, Math.min(365, parsed.interval as number)) : 1;
  return { freq, interval };
}

export function eventCounts(eventId: string): EventCounts {
  const row = eventCountsStmt.get(eventId) as { joined: number; waitlist: number };
  return { joined: Number(row.joined), waitlist: Number(row.waitlist) };
}

export function getEvent(eventId: string): EventRow | undefined {
  return eventGet.get(eventId) as EventRow | undefined;
}

export function getEventInGuild(guildId: string, id: string): EventRow | undefined {
  return eventGetInGuild.get(id, guildId) as EventRow | undefined;
}

export function eventParticipants(eventId: string): ParticipantRow[] {
  return participantsOf.all(eventId) as ParticipantRow[];
}

export type RenderableEvent = { status: EventStatus; scheduledAt: number; maxParticipants: number; registrationEnabled: boolean; waitlistEnabled: boolean };

export function renderableOf(row: EventRow): RenderableEvent {
  return { status: row.status, scheduledAt: row.scheduled_at, maxParticipants: row.max_participants, registrationEnabled: Boolean(row.registration_enabled), waitlistEnabled: Boolean(row.waitlist_enabled) };
}

export function renderEventEmbed(lang: Locale, event: RenderableEvent, embed: EventEmbed, counts: EventCounts): EventEmbedPayload {
  const tr = (k: Parameters<typeof eventsTr>[1], v?: Record<string, string | number>) => eventsTr(lang, k, v);
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

export type RenderedEventButton = EventButton & { disabled: boolean };

export function renderEventButtons(event: RenderableEvent, buttons: EventButton[], counts: EventCounts): RenderedEventButton[] {
  const closed = event.status !== "scheduled" && event.status !== "live";
  const limitReached = event.maxParticipants > 0 && counts.joined >= event.maxParticipants;
  return buttons
    .sort((a, b) => a.order - b.order)
    .map(b => ({ ...b, disabled: !b.enabled || (b.key === "join" ? event.status !== "scheduled" || !event.registrationEnabled || (limitReached && !event.waitlistEnabled) : closed) }));
}

type JoinOutcome = "joined" | "waitlisted" | "already_joined";
type JoinResult = { ok: true; action: JoinOutcome; state: "joined" | "waitlisted"; counts: EventCounts } | { ok: false; error: string };

export function joinEvent(eventId: string, userId: string, guildId?: string): JoinResult {
  const lang = guildLang(guildId ?? "");
  return withTransaction(() => {
    const event = eventGet.get(eventId) as EventRow | undefined;
    if (!event || (guildId !== undefined && event.guild_id !== guildId)) return { ok: false, error: eventsTr(lang, "notFound") };
    if (event.status !== "scheduled") return { ok: false, error: eventsTr(lang, event.status === "live" ? "evAlreadyLive" : "evRegClosed") };
    if (!event.registration_enabled) return { ok: false, error: eventsTr(lang, "evRegDisabled") };
    const existing = participantGet.get(eventId, userId) as ParticipantRow | undefined;
    if (existing) return { ok: true, action: "already_joined", state: existing.waitlist ? "waitlisted" : "joined", counts: eventCounts(eventId) };
    const counts = eventCounts(eventId);
    const limitReached = event.max_participants > 0 && counts.joined >= event.max_participants;
    if (limitReached && !event.waitlist_enabled) return { ok: false, error: eventsTr(lang, "evFull") };
    participantInsert.run(eventId, userId, Date.now(), limitReached ? 1 : 0);
    return { ok: true, action: limitReached ? "waitlisted" : "joined", state: limitReached ? "waitlisted" : "joined", counts: eventCounts(eventId) };
  });
}

type LeaveOutcome = "left" | "left_waitlist" | "promoted" | "not_registered";
type LeaveResult = { ok: true; action: LeaveOutcome; promotedUserId: string | null; counts: EventCounts } | { ok: false; error: string };

export function leaveEvent(eventId: string, userId: string, guildId?: string): LeaveResult {
  const lang = guildLang(guildId ?? "");
  return withTransaction(() => {
    const event = eventGet.get(eventId) as EventRow | undefined;
    if (!event || (guildId !== undefined && event.guild_id !== guildId)) return { ok: false, error: eventsTr(lang, "notFound") };
    if (event.status !== "scheduled" && event.status !== "live") return { ok: false, error: eventsTr(lang, "evRegClosed") };
    const row = participantGet.get(eventId, userId) as ParticipantRow | undefined;
    if (!row) return { ok: true, action: "not_registered", promotedUserId: null, counts: eventCounts(eventId) };
    participantDelete.run(eventId, userId);
    let promotedUserId: string | null = null;
    if (!row.waitlist) promotedUserId = promoteFromWaitlist(event);
    return { ok: true, action: row.waitlist ? "left_waitlist" : promotedUserId ? "promoted" : "left", promotedUserId, counts: eventCounts(eventId) };
  });
}

function promoteFromWaitlist(event: EventRow): string | null {
  if (!event.waitlist_enabled || event.max_participants <= 0) return null;
  const joined = eventCounts(event.id).joined;
  if (joined >= event.max_participants) return null;
  const next = nextWaitlistedStmt.get(event.id) as { user_id: string } | undefined;
  if (!next) return null;
  participantPromote.run(event.id, next.user_id);
  return next.user_id;
}

// Удаление участника со стороны панели — та же семантика продвижения, что у leave.
export function removeParticipant(eventId: string, userId: string, guildId?: string): { action: "removed" | "promoted"; promotedUserId: string | null } | null {
  return withTransaction(() => {
    const event = eventGet.get(eventId) as EventRow | undefined;
    if (!event || (guildId !== undefined && event.guild_id !== guildId)) return null;
    const row = participantGet.get(eventId, userId) as ParticipantRow | undefined;
    if (!row) return null;
    participantDelete.run(eventId, userId);
    const promotedUserId = row.waitlist ? null : promoteFromWaitlist(event);
    return { action: promotedUserId ? "promoted" : "removed", promotedUserId };
  });
}

export function removeParticipantFromGuild(guildId: string, userId: string): { eventId: string; promotedUserId: string | null }[] {
  const rows = eventsOfUserInGuild.all(guildId, userId) as { event_id: string }[];
  const results: { eventId: string; promotedUserId: string | null }[] = [];
  for (const row of rows) {
    const result = removeParticipant(row.event_id, userId);
    if (result) results.push({ eventId: row.event_id, promotedUserId: result.promotedUserId });
  }
  return results;
}

function recomputeReminders(event: EventRow) {
  reminderDeleteUnsent.run(event.id);
  if (event.status === "completed" || event.status === "cancelled") return;
  const now = Date.now();
  const offsets = parseEventReminders(event.reminders_json);
  for (const offset of offsets) {
    const dueAt = event.scheduled_at - offset * 60_000;
    if (dueAt > now) reminderInsert.run(event.id, dueAt);
  }
}

// Идемпотентный claim: ровно один вызвавший получает changes=1 и шлёт
export function claimReminder(reminderId: number, at: number): boolean {
  return reminderClaim.run(at, reminderId).changes === 1;
}

export function dueReminders(at: number): { id: number; event_id: string }[] {
  return remindersDue.all(at) as { id: number; event_id: string }[];
}

const eventFlipLive = db.prepare("UPDATE events SET status='live',started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND status='scheduled'");

export function transitionDueEvents(now: number): { changed: EventRow[]; created: EventRow[] } {
  const changed: EventRow[] = [];
  const created: EventRow[] = [];
  withTransaction(() => {
    for (const event of eventsDueLive.all(now) as EventRow[]) {
      const result = eventFlipLive.run(now, now, event.id);
      if (Number(result.changes) === 0) continue;
      const updated: EventRow = { ...event, status: "live", started_at: event.started_at ?? now, updated_at: now };
      changed.push(updated);
      const recurrence = parseEventRecurrence(event.recurrence_json);
      if (recurrence.freq === "none") continue;
      const seriesId = event.series_id ?? event.id;
      if (nextInSeries.get(seriesId)) continue;
      const step = intervalDays(recurrence) * DAY_MS;
      let nextScheduledAt = event.scheduled_at + step;
      while (nextScheduledAt <= now) nextScheduledAt += step;
      const id = crypto.randomUUID();
      const at = Date.now();
      eventInsert.run(id, event.guild_id, event.channel_id, null, seriesId, event.embed_json, event.buttons_json, nextScheduledAt, event.max_participants, event.registration_enabled, event.waitlist_enabled, "scheduled", event.event_role_id, event.reminders_json, event.recurrence_json, at, at, null, null, null, null);
      const follower = eventGet.get(id) as EventRow;
      recomputeReminders(follower);
      created.push(follower);
    }
  });
  return { changed, created };
}

function intervalDays(recurrence: EventRecurrence): number {
  if (recurrence.freq === "daily") return 1;
  if (recurrence.freq === "weekly") return 7;
  if (recurrence.freq === "biweekly") return 14;
  return recurrence.interval;
}

export type EventInput = {
  id?: string;
  channelId: string;
  messageId: string | null;
  embed: EventEmbed;
  buttons: EventButton[];
  scheduledAt: number;
  maxParticipants: number;
  registrationEnabled: boolean;
  waitlistEnabled: boolean;
  status: EventStatus;
  eventRoleId: string | null;
  reminders: number[];
  recurrence: EventRecurrence;
};

export function insertEvent(guildId: string, input: EventInput): EventRow {
  const id = input.id ?? crypto.randomUUID();
  const now = Date.now();
  const startedAt = input.status === "live" ? now : null;
  // Повторяющееся событие — корень своей серии, так находятся последователи.
  const seriesId = input.recurrence.freq !== "none" ? id : null;
  return withTransaction(() => {
    eventInsert.run(id, guildId, input.channelId, input.messageId, seriesId, JSON.stringify(input.embed), JSON.stringify(input.buttons), input.scheduledAt, input.maxParticipants, input.registrationEnabled ? 1 : 0, input.waitlistEnabled ? 1 : 0, input.status, input.eventRoleId, JSON.stringify(input.reminders), JSON.stringify(input.recurrence), now, now, startedAt, null, null, null);
    const row = eventGet.get(id) as EventRow;
    recomputeReminders(row);
    return row;
  });
}

export function updateEvent(guildId: string, id: string, input: EventInput): EventRow | null {
  return withTransaction(() => {
    const current = eventGetInGuild.get(id, guildId) as EventRow | undefined;
    if (!current) return null;
    const now = Date.now();
    let startedAt = current.started_at;
    if (input.status === "live" && !startedAt) startedAt = now;
    let completedAt = current.completed_at;
    let cancelledAt = current.cancelled_at;
    let statsJson = current.stats_json;
    if (input.status === "completed" && current.status !== "completed") {
      completedAt = now;
      if (!startedAt) startedAt = now;
      statsJson = JSON.stringify(recordStats({ ...current, status: "completed", started_at: startedAt, max_participants: input.maxParticipants, created_at: current.created_at }, completedAt));
    } else if (input.status !== "completed" && current.status === "completed") {
      completedAt = null;
      statsJson = null;
    }
    if (input.status === "cancelled" && current.status !== "cancelled") cancelledAt = now;
    else if (input.status !== "cancelled" && current.status === "cancelled") cancelledAt = null;
    eventUpdate.run(input.channelId, input.messageId, JSON.stringify(input.embed), JSON.stringify(input.buttons), input.scheduledAt, input.maxParticipants, input.registrationEnabled ? 1 : 0, input.waitlistEnabled ? 1 : 0, input.status, input.eventRoleId, JSON.stringify(input.reminders), JSON.stringify(input.recurrence), now, startedAt, completedAt, cancelledAt, statsJson, id, guildId);
    const row = eventGet.get(id) as EventRow;
    recomputeReminders(row);
    return row;
  });
}

function recordStats(event: EventRow, completedAt: number): Record<string, unknown> {
  const counts = eventCounts(event.id);
  return {
    registered: counts.joined + counts.waitlist,
    participants: counts.joined,
    waitlist: counts.waitlist,
    maxParticipants: event.max_participants,
    createdAt: event.created_at,
    startedAt: event.started_at ?? completedAt,
    completedAt,
  };
}

export function deleteEvent(guildId: string, id: string): { channelId: string; messageId: string | null; embed: EventEmbed } | null {
  const row = eventGetInGuild.get(id, guildId) as EventRow | undefined;
  if (!row) return null;
  eventDelete.run(id, guildId);
  return { channelId: row.channel_id, messageId: row.message_id, embed: parseEventEmbed(row.embed_json) };
}

export function deleteEventsByGuild(guildId: string): number {
  return Number(eventDeleteByGuild.run(guildId).changes);
}

export function updateEventMessage(eventId: string, messageId: string) {
  eventUpdateMessage.run(messageId, Date.now(), eventId);
}

// Бот увидел удаление сообщения: ссылка отвязывается, чтобы следующее
// обновление создало сообщение заново, а не редактировало призрак.
export function detachEventMessage(messageId: string) {
  eventDetachByMessage.run(Date.now(), messageId);
}

type EventView = {
  id: string; guildId: string; channelId: string; messageId: string | null;
  embed: EventEmbed; buttons: EventButton[];
  scheduledAt: number; maxParticipants: number;
  registrationEnabled: boolean; waitlistEnabled: boolean; status: EventStatus;
  eventRoleId: string | null; reminders: number[]; recurrence: EventRecurrence;
  createdAt: number; updatedAt: number; startedAt: number | null;
  completedAt: number | null; cancelledAt: number | null;
  stats: Record<string, unknown> | null; counts: EventCounts;
  participants: { userId: string; joinedAt: number; waitlist: boolean }[];
};

// Базовая сборка без counts/participants — список гильдии собирает их
// пакетно (см. listEvents), одиночные пути досчитывают сами.
function toEventViewBase(row: EventRow): Omit<EventView, "counts" | "participants"> {
  return {
    id: row.id, guildId: row.guild_id, channelId: row.channel_id, messageId: row.message_id,
    embed: parseEventEmbed(row.embed_json), buttons: parseEventButtons(row.buttons_json),
    scheduledAt: row.scheduled_at, maxParticipants: row.max_participants,
    registrationEnabled: Boolean(row.registration_enabled), waitlistEnabled: Boolean(row.waitlist_enabled),
    status: row.status, eventRoleId: row.event_role_id,
    reminders: parseEventReminders(row.reminders_json), recurrence: parseEventRecurrence(row.recurrence_json),
    createdAt: row.created_at, updatedAt: row.updated_at, startedAt: row.started_at,
    completedAt: row.completed_at, cancelledAt: row.cancelled_at,
    stats: safeJson<Record<string, unknown> | null>(row.stats_json, null),
  };
}

export function listEvents(guildId: string): EventView[] {
  const rows = eventList.all(guildId) as EventRow[];
  if (!rows.length) return [];
  // Пакетная сборка: два запроса на гильдию вместо трёх на событие.
  const counts = new Map<string, EventCounts>();
  for (const row of countsByGuildStmt.all(guildId) as { eventId: string; joined: number; waitlist: number }[]) {
    counts.set(row.eventId, { joined: Number(row.joined), waitlist: Number(row.waitlist) });
  }
  const participants = new Map<string, { userId: string; joinedAt: number; waitlist: boolean }[]>();
  for (const p of participantsByGuildStmt.all(guildId) as { eventId: string; userId: string; joinedAt: number; waitlist: number }[]) {
    let list = participants.get(p.eventId);
    if (!list) { list = []; participants.set(p.eventId, list); }
    list.push({ userId: p.userId, joinedAt: p.joinedAt, waitlist: Boolean(p.waitlist) });
  }
  return rows.map(row => ({
    ...toEventViewBase(row),
    counts: counts.get(row.id) ?? { joined: 0, waitlist: 0 },
    participants: participants.get(row.id) ?? [],
  }));
}

export type EventListItem = Omit<EventView, "participants"> & {
  participants: (EventView["participants"][number] & { name: string | null })[];
};
export type EventListGet = { events: EventListItem[] };

export async function applyEventRole(guildId: string, userId: string, roleId: string | null, add: boolean): Promise<void> {
  if (!roleId) return;
  try {
    await discordFetch(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: add ? "PUT" : "DELETE" });
  } catch (error) {
    // Участник останется без роли события молча — фиксируем хотя бы в лог.
    logger.warn("[EVENTS] Не удалось изменить роль события", guildId, userId, add, error);
  }
}

export async function sendReminderDm(userId: string, event: EventRow): Promise<boolean> {
  const embed = parseEventEmbed(event.embed_json);
  const at = Math.floor(event.scheduled_at / 1000);
  const guild = (stmt.guildName.get(event.guild_id) as { name: string } | undefined)?.name;
  const lang = guildLang(event.guild_id);
  const serverPart = guild ? " " + eventsTr(lang, "onServer").replace("{s}", guild) : "";
  const content = `⏰ **${eventsTr(lang, "reminderTitle")}**${serverPart}
📌 **${embed.title ?? eventsTr(lang, "defaultEventWord")}**
🕒 <t:${at}:F> (<t:${at}:R>)`;
  return sendDiscordDM(userId, content);
}

export function clampEventInput(input: Record<string, unknown>): EventInput | { error: string } {
  if (!input || typeof input !== "object") return { error: "Некорректные данные события." };
  const channelId = typeof input.channelId === "string" ? input.channelId : "";
  if (!isSnowflake(channelId)) return { error: "Выберите канал для события." };
  const scheduledAt = Number(input.scheduledAt);
  if (!Number.isInteger(scheduledAt) || scheduledAt <= 0) return { error: "Укажите дату и время события." };
  const status: EventStatus = eventStatuses.find(value => value === input.status) ?? "scheduled";
  const maxParticipants = clampNumber(input.maxParticipants, 0, 0, MAX_PARTICIPANTS_LIMIT, "integer");
  const eventRoleId = typeof input.eventRoleId === "string" && isSnowflake(input.eventRoleId) ? input.eventRoleId : null;
  const reminders = sanitizeReminders(input.reminders);
  const recurrence: EventRecurrence = parseEventRecurrence(typeof input.recurrence === "object" && input.recurrence !== null ? JSON.stringify(input.recurrence) : null);
  const embed = cleanEmbed(input.payload);
  const buttons = cleanButtons(input.buttons);
  if (!embed.title && !embed.description && !embed.fields?.length) return { error: "Заполните сообщение события: заголовок, описание или хотя бы одно поле." };
  return {
    channelId, messageId: null, embed, buttons, scheduledAt, maxParticipants,
    registrationEnabled: input.registrationEnabled !== false, waitlistEnabled: input.waitlistEnabled !== false,
    status, eventRoleId, reminders, recurrence,
  };
}

function cleanEmbed(value: unknown): EventEmbed {
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

function cleanButtons(value: unknown): EventButton[] {
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