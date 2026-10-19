import { withTransaction } from "../../db/database.ts";
import { DAY_MS, clampNumber } from "../constants.ts";
import { discordFetch, sendDiscordDM } from "../discord-api.ts";
import { isSnowflake } from "../ids.ts";
import { stmt } from "../../db/statements.ts";
import { safeJson } from "../json.ts";
import { logger } from "../logger.ts";
import { eventsTr, guildLang } from "../i18n/bot.ts";
import {
  cleanButtons, cleanEmbed, parseEventButtons, parseEventEmbed, parseEventRecurrence, parseEventReminders,
  sanitizeReminders,
} from "./embed.ts";
import {
  MAX_PARTICIPANTS_LIMIT, eventStatuses,
  type EventCounts, type EventEmbed, type EventInput, type EventRecurrence, type EventRow,
  type EventStatus, type EventView, type JoinResult, type LeaveResult, type ParticipantRow,
} from "./types.ts";

export function eventCounts(eventId: string): EventCounts {
  const row = stmt.eventCounts.get(eventId) as { joined: number; waitlist: number };
  return { joined: Number(row.joined), waitlist: Number(row.waitlist) };
}

export function getEvent(eventId: string): EventRow | undefined {
  return stmt.eventGet.get(eventId) as EventRow | undefined;
}

export function getEventInGuild(guildId: string, id: string): EventRow | undefined {
  return stmt.eventGetInGuild.get(id, guildId) as EventRow | undefined;
}

export function eventParticipants(eventId: string): ParticipantRow[] {
  return stmt.participantsOf.all(eventId) as ParticipantRow[];
}

export function joinEvent(eventId: string, userId: string, guildId?: string): JoinResult {
  const lang = guildLang(guildId ?? "");
  return withTransaction(() => {
    const event = stmt.eventGet.get(eventId) as EventRow | undefined;
    if (!event || (guildId !== undefined && event.guild_id !== guildId)) return { ok: false, error: eventsTr(lang, "notFound") };
    if (event.status !== "scheduled") return { ok: false, error: eventsTr(lang, event.status === "live" ? "evAlreadyLive" : "evRegClosed") };
    if (!event.registration_enabled) return { ok: false, error: eventsTr(lang, "evRegDisabled") };
    const existing = stmt.participantGet.get(eventId, userId) as ParticipantRow | undefined;
    if (existing) return { ok: true, action: "already_joined", state: existing.waitlist ? "waitlisted" : "joined", counts: eventCounts(eventId) };
    const counts = eventCounts(eventId);
    const limitReached = event.max_participants > 0 && counts.joined >= event.max_participants;
    if (limitReached && !event.waitlist_enabled) return { ok: false, error: eventsTr(lang, "evFull") };
    stmt.participantInsert.run(eventId, userId, Date.now(), limitReached ? 1 : 0);
    return { ok: true, action: limitReached ? "waitlisted" : "joined", state: limitReached ? "waitlisted" : "joined", counts: eventCounts(eventId) };
  });
}

export function leaveEvent(eventId: string, userId: string, guildId?: string): LeaveResult {
  const lang = guildLang(guildId ?? "");
  return withTransaction(() => {
    const event = stmt.eventGet.get(eventId) as EventRow | undefined;
    if (!event || (guildId !== undefined && event.guild_id !== guildId)) return { ok: false, error: eventsTr(lang, "notFound") };
    if (event.status !== "scheduled" && event.status !== "live") return { ok: false, error: eventsTr(lang, "evRegClosed") };
    const row = stmt.participantGet.get(eventId, userId) as ParticipantRow | undefined;
    if (!row) return { ok: true, action: "not_registered", promotedUserId: null, counts: eventCounts(eventId) };
    stmt.participantDelete.run(eventId, userId);
    let promotedUserId: string | null = null;
    if (!row.waitlist) promotedUserId = promoteFromWaitlist(event);
    return { ok: true, action: row.waitlist ? "left_waitlist" : promotedUserId ? "promoted" : "left", promotedUserId, counts: eventCounts(eventId) };
  });
}

function promoteFromWaitlist(event: EventRow): string | null {
  if (!event.waitlist_enabled || event.max_participants <= 0) return null;
  const joined = eventCounts(event.id).joined;
  if (joined >= event.max_participants) return null;
  const next = stmt.eventNextWaitlisted.get(event.id) as { user_id: string } | undefined;
  if (!next) return null;
  stmt.participantPromote.run(event.id, next.user_id);
  return next.user_id;
}

// Удаление участника со стороны панели — та же семантика продвижения, что у leave.
export function removeParticipant(eventId: string, userId: string, guildId?: string): { action: "removed" | "promoted"; promotedUserId: string | null } | null {
  return withTransaction(() => {
    const event = stmt.eventGet.get(eventId) as EventRow | undefined;
    if (!event || (guildId !== undefined && event.guild_id !== guildId)) return null;
    const row = stmt.participantGet.get(eventId, userId) as ParticipantRow | undefined;
    if (!row) return null;
    stmt.participantDelete.run(eventId, userId);
    const promotedUserId = row.waitlist ? null : promoteFromWaitlist(event);
    return { action: promotedUserId ? "promoted" : "removed", promotedUserId };
  });
}

export function removeParticipantFromGuild(guildId: string, userId: string): { eventId: string; promotedUserId: string | null }[] {
  const rows = stmt.eventsOfUserInGuild.all(guildId, userId) as { event_id: string }[];
  const results: { eventId: string; promotedUserId: string | null }[] = [];
  for (const row of rows) {
    const result = removeParticipant(row.event_id, userId);
    if (result) results.push({ eventId: row.event_id, promotedUserId: result.promotedUserId });
  }
  return results;
}

function recomputeReminders(event: EventRow) {
  stmt.reminderDeleteUnsent.run(event.id);
  if (event.status === "completed" || event.status === "cancelled") return;
  const now = Date.now();
  const offsets = parseEventReminders(event.reminders_json);
  for (const offset of offsets) {
    const dueAt = event.scheduled_at - offset * 60_000;
    if (dueAt > now) stmt.reminderInsert.run(event.id, dueAt);
  }
}

// Идемпотентный claim: ровно один вызвавший получает changes=1 и шлёт напоминание.
export function claimReminder(reminderId: number, at: number): boolean {
  return stmt.reminderClaim.run(at, reminderId).changes === 1;
}

export function dueReminders(at: number): { id: number; event_id: string }[] {
  return stmt.remindersDue.all(at) as { id: number; event_id: string }[];
}

export function transitionDueEvents(now: number): { changed: EventRow[]; created: EventRow[] } {
  const changed: EventRow[] = [];
  const created: EventRow[] = [];
  withTransaction(() => {
    for (const event of stmt.eventsDueLive.all(now) as EventRow[]) {
      const result = stmt.eventFlipLive.run(now, now, event.id);
      if (Number(result.changes) === 0) continue;
      const updated: EventRow = { ...event, status: "live", started_at: event.started_at ?? now, updated_at: now };
      changed.push(updated);
      const recurrence = parseEventRecurrence(event.recurrence_json);
      if (recurrence.freq === "none") continue;
      const seriesId = event.series_id ?? event.id;
      if (stmt.eventNextInSeries.get(seriesId)) continue;
      const step = intervalDays(recurrence) * DAY_MS;
      let nextScheduledAt = event.scheduled_at + step;
      while (nextScheduledAt <= now) nextScheduledAt += step;
      const id = crypto.randomUUID();
      const at = Date.now();
      stmt.eventInsert.run(id, event.guild_id, event.channel_id, null, seriesId, event.embed_json, event.buttons_json, nextScheduledAt, event.max_participants, event.registration_enabled, event.waitlist_enabled, "scheduled", event.event_role_id, event.reminders_json, event.recurrence_json, at, at, null, null, null, null);
      const follower = stmt.eventGet.get(id) as EventRow;
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

export function insertEvent(guildId: string, input: EventInput): EventRow {
  const id = input.id ?? crypto.randomUUID();
  const now = Date.now();
  const startedAt = input.status === "live" ? now : null;
  // Повторяющееся событие — корень своей серии, так находятся последователи.
  const seriesId = input.recurrence.freq !== "none" ? id : null;
  return withTransaction(() => {
    stmt.eventInsert.run(id, guildId, input.channelId, input.messageId, seriesId, JSON.stringify(input.embed), JSON.stringify(input.buttons), input.scheduledAt, input.maxParticipants, input.registrationEnabled ? 1 : 0, input.waitlistEnabled ? 1 : 0, input.status, input.eventRoleId, JSON.stringify(input.reminders), JSON.stringify(input.recurrence), now, now, startedAt, null, null, null);
    const row = stmt.eventGet.get(id) as EventRow;
    recomputeReminders(row);
    return row;
  });
}

export function updateEvent(guildId: string, id: string, input: EventInput): EventRow | null {
  return withTransaction(() => {
    const current = stmt.eventGetInGuild.get(id, guildId) as EventRow | undefined;
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
    stmt.eventUpdate.run(input.channelId, input.messageId, JSON.stringify(input.embed), JSON.stringify(input.buttons), input.scheduledAt, input.maxParticipants, input.registrationEnabled ? 1 : 0, input.waitlistEnabled ? 1 : 0, input.status, input.eventRoleId, JSON.stringify(input.reminders), JSON.stringify(input.recurrence), now, startedAt, completedAt, cancelledAt, statsJson, id, guildId);
    const row = stmt.eventGet.get(id) as EventRow;
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
  const row = stmt.eventGetInGuild.get(id, guildId) as EventRow | undefined;
  if (!row) return null;
  stmt.eventDelete.run(id, guildId);
  return { channelId: row.channel_id, messageId: row.message_id, embed: parseEventEmbed(row.embed_json) };
}

export function deleteEventsByGuild(guildId: string): number {
  return Number(stmt.eventDeleteByGuild.run(guildId).changes);
}

export function updateEventMessage(eventId: string, messageId: string) {
  stmt.eventUpdateMessage.run(messageId, Date.now(), eventId);
}

// Бот увидел удаление сообщения: ссылка отвязывается, чтобы следующее
// обновление создало сообщение заново, а не редактировало призрак.
export function detachEventMessage(messageId: string) {
  stmt.eventDetachByMessage.run(Date.now(), messageId);
}

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
  const rows = stmt.eventList.all(guildId) as EventRow[];
  if (!rows.length) return [];
  // Пакетная сборка: два запроса на гильдию вместо трёх на событие.
  const counts = new Map<string, EventCounts>();
  for (const row of stmt.eventCountsByGuild.all(guildId) as { eventId: string; joined: number; waitlist: number }[]) {
    counts.set(row.eventId, { joined: Number(row.joined), waitlist: Number(row.waitlist) });
  }
  const participants = new Map<string, { userId: string; joinedAt: number; waitlist: boolean }[]>();
  for (const p of stmt.eventParticipantsByGuild.all(guildId) as { eventId: string; userId: string; joinedAt: number; waitlist: number }[]) {
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

export async function applyEventRole(guildId: string, userId: string, roleId: string | null, add: boolean): Promise<void> {
  if (!roleId) return;
  try {
    // discordFetch не бросает на 4xx/5xx — статус проверяем вручную, иначе
    // отказ Discord (нет прав, участник вышел) остался бы незамеченным.
    const response = await discordFetch(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: add ? "PUT" : "DELETE" });
    if (!response.ok) logger.warn("[EVENTS] Не удалось изменить роль события", guildId, userId, add, response.status);
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
