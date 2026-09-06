import test from "node:test"; import assert from "node:assert/strict";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { mkdtempSync } from "node:fs";

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "goplay-events-test-")), "bot.sqlite");
import type { EventInput } from "../src/lib/events.ts";
const events = await import("../src/lib/events.ts");
const { db } = await import("../src/db/database.ts");
const { parseEventEmbed, parseEventButtons } = events;
const { insertEvent, updateEvent, getEvent, getEventInGuild, listEvents, deleteEvent, eventCounts, joinEvent, leaveEvent, removeParticipant, removeParticipantFromGuild, claimReminder, dueReminders, transitionDueEvents, renderEventEmbed, renderEventButtons, renderableOf, clampEventInput, updateEventMessage, detachEventMessage } = events;

for (const guildId of ["g1", "g2"]) db.prepare("INSERT OR IGNORE INTO guilds(id,name,icon,updated_at) VALUES(?,?,?,?)").run(guildId, guildId, null, Date.now());

const now = Date.now();
const baseInput = (): EventInput => ({
  channelId: "111111111111111111", messageId: null,
  embed: { title: "Киновечер", description: "Смотрим кино в голосовом", color: 123, footer: { text: "Событие" }, timestamp: true },
  buttons: [{ key: "join", label: "Участвовать", emoji: "✅", style: "primary", enabled: true, order: 1 }, { key: "leave", label: "Отказаться", emoji: "❌", style: "danger", enabled: true, order: 2 }],
  scheduledAt: now + 86_400_000, maxParticipants: 2, registrationEnabled: true, waitlistEnabled: true,
  status: "scheduled", eventRoleId: "222222222222222222", reminders: [60, 1440], recurrence: { freq: "none", interval: 1 },
});

test("insertEvent stores the row and creates a series root for recurring events", () => {
  const row = insertEvent("g1", baseInput());
  assert.equal(row.guild_id, "g1");
  assert.equal(row.message_id, null);
  assert.equal(parseEventEmbed(row.embed_json).title, "Киновечер");
  assert.equal(parseEventButtons(row.buttons_json).length, 2);
  assert.equal(row.series_id, null, "без повторения серия не нужна");
  const recurring = insertEvent("g1", { ...baseInput(), recurrence: { freq: "weekly", interval: 1 } });
  assert.equal(recurring.series_id, recurring.id, "повторяющееся событие — корень своей серии");
});

test("insertEvent with explicit id is respected (message custom ids need it)", () => {
  const row = insertEvent("g1", { ...baseInput(), id: "custom-id-1" });
  assert.equal(row.id, "custom-id-1");
});

test("clampEventInput validates and normalizes", () => {
  assert.ok("error" in clampEventInput({ ...baseInput(), channelId: "abc" }), "плохой канал");
  assert.ok("error" in clampEventInput({ ...baseInput(), scheduledAt: 0 }), "нет даты");
  assert.ok("error" in clampEventInput({ ...baseInput(), payload: { title: "   " } }), "пустой embed");
  const ok = clampEventInput({ ...baseInput(), maxParticipants: 9999999, reminders: [0, 60, 60, 999999999, -5, 1440], payload: { title: "Киновечер", timestamp: true }, recurrence: { freq: "custom", interval: 42 } });
  assert.ok(!("error" in ok));
  assert.equal(ok.maxParticipants, 100000, "лимит обрезается до 100 000");
  assert.deepEqual(ok.reminders, [60, 1440], "дубли убираются, мусор отсекается, порядок сохраняется");
  assert.equal(ok.recurrence.freq, "custom");
  assert.equal(ok.buttons.length, 2, "кнопки по умолчанию на месте");
});

test("join/leave happy path and duplicates", () => {
  const row = insertEvent("g1", baseInput());
  const first = joinEvent(row.id, "u1", "g1");
  assert.deepEqual(first, { ok: true, action: "joined", state: "joined", counts: { joined: 1, waitlist: 0 } });
  const again = joinEvent(row.id, "u1", "g1");
  assert.equal(again.ok && again.action, "already_joined");
  assert.equal(eventCounts(row.id).joined, 1);
  const leave = leaveEvent(row.id, "u1", "g1");
  assert.equal(leave.ok && leave.action, "left");
  assert.equal(eventCounts(row.id).joined, 0);
  const notRegistered = leaveEvent(row.id, "u1", "g1");
  assert.equal(notRegistered.ok && notRegistered.action, "not_registered");
});

test("join respects guild scope, closed status and disabled registration", () => {
  const row = insertEvent("g2", baseInput());
  assert.equal(joinEvent(row.id, "u1", "g1").ok, false, "чужой сервер");
  const closed = updateEvent("g2", row.id, { ...baseInput(), status: "completed" })!;
  assert.equal(joinEvent(closed.id, "u1", "g2").ok, false, "завершено — закрыто");
  const noReg = updateEvent("g2", row.id, { ...baseInput(), status: "scheduled", registrationEnabled: false })!;
  assert.equal(joinEvent(noReg.id, "u1", "g2").ok, false, "регистрация выключена");
  const live = updateEvent("g2", row.id, { ...baseInput(), status: "live" })!;
  assert.equal(joinEvent(live.id, "u1", "g2").ok, false, "идёт — регистрация закрыта");
});

test("waitlist: full event queues users, leaving promotes the first queued", () => {
  const row = insertEvent("g1", { ...baseInput(), maxParticipants: 1, waitlistEnabled: true });
  const first = joinEvent(row.id, "u1", "g1");
  assert.equal(first.ok && first.state, "joined");
  // Повторный join тем же пользователем не занимает второй слот.
  const second = joinEvent(row.id, "u1", "g1");
  assert.equal(second.ok ? second.action : "", "already_joined");
  const queued = joinEvent(row.id, "u2", "g1");
  assert.equal(queued.ok && queued.action, "waitlisted");
  assert.deepEqual(eventCounts(row.id), { joined: 1, waitlist: 1 });
  const third = joinEvent(row.id, "u3", "g1");
  assert.equal(third.ok && third.action, "waitlisted");
  assert.deepEqual(eventCounts(row.id), { joined: 1, waitlist: 2 });
  const left = leaveEvent(row.id, "u1", "g1");
  assert.equal(left.ok && left.action, "promoted");
  assert.equal(left.ok && left.promotedUserId, "u2", "первый в очереди продвигается");
  assert.deepEqual(eventCounts(row.id), { joined: 1, waitlist: 1 });
});

test("waitlist disabled: full event rejects", () => {
  const row = insertEvent("g1", { ...baseInput(), maxParticipants: 1, waitlistEnabled: false });
  joinEvent(row.id, "u1", "g1");
  const rejected = joinEvent(row.id, "u2", "g1");
  assert.equal(rejected.ok, false);
  assert.match((rejected as { error: string }).error, /мест/i);
});

test("removeParticipant and removeParticipantFromGuild promote correctly", () => {
  const row = insertEvent("g1", { ...baseInput(), maxParticipants: 1, waitlistEnabled: true });
  joinEvent(row.id, "u1", "g1");
  joinEvent(row.id, "u2", "g1");
  const removed = removeParticipant(row.id, "u1", "g1");
  assert.ok(removed);
  assert.equal(removed.promotedUserId, "u2");
  assert.deepEqual(eventCounts(row.id), { joined: 1, waitlist: 0 });
  const another = insertEvent("g1", baseInput());
  joinEvent(another.id, "u1", "g1");
  const results = removeParticipantFromGuild("g1", "u1");
  assert.ok(results.some(r => r.eventId === another.id), "участник убран из всех событий сервера");
  assert.equal(eventCounts(another.id).joined, 0);
});

test("reminders: only future ones are scheduled and claims are idempotent", () => {
  const row = insertEvent("g1", { ...baseInput(), scheduledAt: now + 7_200_000, reminders: [60, 9999, 1440] });
  const due = dueReminders(now + 60 * 60_000 + 1000);
  const pending = due.filter(r => r.event_id === row.id);
  assert.equal(pending.length, 1, "прошлые напоминания не планируются");
  const pendingReminder = pending[0];
  assert.ok(pendingReminder);
  assert.ok(claimReminder(pendingReminder.id, now), "первый claim проходит");
  assert.equal(claimReminder(pendingReminder.id, now), false, "повторный claim невозможен");
  assert.equal(dueReminders(now + 10_000).filter(r => r.event_id === row.id).length, 0);
});

test("updateEvent completes the event: stats snapshot and reminder cleanup", () => {
  const row = insertEvent("g1", baseInput());
  joinEvent(row.id, "u1", "g1");
  joinEvent(row.id, "u2", "g1");
  const completed = updateEvent("g1", row.id, { ...baseInput(), status: "completed" })!;
  assert.equal(completed.status, "completed");
  assert.ok(completed.completed_at, "время завершения записано");
  assert.ok(completed.stats_json);
  const stats = JSON.parse(completed.stats_json!) as Record<string, unknown>;
  assert.equal(stats.participants, 2);
  assert.equal(stats.registered, 2);
  assert.equal(stats.maxParticipants, 2);
  assert.ok(stats.completedAt);
  const undone = updateEvent("g1", row.id, { ...baseInput(), status: "scheduled" })!;
  assert.equal(undone.completed_at, null);
  assert.equal(undone.stats_json, null, "повторный переход сбрасывает итоги");
  const cancelled = updateEvent("g1", row.id, { ...baseInput(), status: "cancelled" })!;
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cancelled_at);
  const uncancelled = updateEvent("g1", row.id, { ...baseInput(), status: "scheduled" })!;
  assert.equal(uncancelled.cancelled_at, null);
});

test("transitionDueEvents flips overdue events and creates exactly one next instance", () => {
  const row = insertEvent("g1", { ...baseInput(), scheduledAt: now - 60_000, recurrence: { freq: "daily", interval: 1 } });
  const { changed, created } = transitionDueEvents(now);
  const flipped = changed.find(e => e.id === row.id);
  assert.ok(flipped, "просроченное событие переведено в live");
  assert.equal(flipped.status, "live");
  assert.ok(flipped.started_at);
  assert.equal(created.length, 1, "создан ровно один следующий экземпляр");
  const createdFollower = created[0];
  assert.ok(createdFollower);
  assert.equal(createdFollower.series_id, row.id, "наследник привязан к серии");
  assert.equal(createdFollower.scheduled_at, row.scheduled_at + 86_400_000, "следующий экземпляр — через интервал");
  const eventsInGuild = listEvents("g1");
  const followers = eventsInGuild.filter(e => e.recurrence.freq === "daily" && e.status === "scheduled" && e.scheduledAt > row.scheduled_at);
  assert.equal(followers.length, 1, "в базе всё ещё один наследник");
  const follower = followers[0];
  assert.ok(follower);
  assert.equal(transitionDueEvents(now).changed.some(e => e.id === row.id), false, "повторный переход невозможен");
  assert.equal(listEvents("g1").filter(e => e.recurrence.freq === "daily" && e.status === "scheduled" && e.scheduledAt > row.scheduled_at).length, 1, "второй экземпляр не дублируется");
});

test("rendering mirrors live state", () => {
  const row = insertEvent("g1", baseInput());
  const counts = { joined: 1, waitlist: 1 };
  const payload = renderEventEmbed("ru", renderableOf(row), parseEventEmbed(row.embed_json), counts);
  assert.equal(payload.title, "Киновечер");
  const dateField = (payload.fields ?? []).find(f => f.name === "🕒 Дата");
  assert.ok(dateField, "дата рендерится полем");
  assert.match(dateField!.value, /^<t:\d+:d> \(<t:\d+:R>\)$/, "формат @time: короткая дата + относительное время");
  const names = (payload.fields ?? []).map(f => f.name);
  assert.ok(names.includes("👥 Участники"), "участники добавляются");
  assert.ok(names.includes("⏳ Очередь"), "очередь добавляется");
  assert.ok(!names.includes("Статус"), "статус scheduled не пишется");
  const liveRow = { ...row, status: "live" as const };
  const livePayload = renderEventEmbed("ru", renderableOf(liveRow), parseEventEmbed(row.embed_json), counts);
  assert.ok((livePayload.fields ?? []).some(f => f.name === "Статус" && f.value === "Идёт сейчас"));
  const full = { joined: 2, waitlist: 0 };
  const buttons = renderEventButtons({ ...renderableOf(row), waitlistEnabled: false }, parseEventButtons(row.buttons_json), full);
  assert.deepEqual(buttons.map(b => b.key), ["join", "leave"], "порядок по order");
  assert.ok(buttons.find(b => b.key === "join")!.disabled, "лимит достигнут, очередь выключена — join отключена");
  assert.ok(!buttons.find(b => b.key === "leave")!.disabled);
  const closedButtons = renderEventButtons(renderableOf({ ...row, status: "completed" }), parseEventButtons(row.buttons_json), { joined: 2, waitlist: 0 });
  assert.ok(closedButtons.every(b => b.disabled), "завершено — обе кнопки отключены");
  const liveButtons = renderEventButtons(renderableOf({ ...row, status: "live" as const }), parseEventButtons(row.buttons_json), { joined: 0, waitlist: 0 });
  assert.ok(liveButtons.find(b => b.key === "join")!.disabled, "идёт — записаться нельзя");
  assert.ok(!liveButtons.find(b => b.key === "leave")!.disabled, "идёт — можно отказаться");
});

test("deleteEvent, updateEventMessage and detachEventMessage", () => {
  const row = insertEvent("g1", baseInput());
  const removed = deleteEvent("g1", row.id);
  assert.ok(removed);
  assert.equal(removed.messageId, null);
  assert.equal(removed.embed.title, "Киновечер");
  assert.equal(deleteEvent("g1", row.id), null, "повторное удаление невозможно");
  assert.equal(getEventInGuild("g1", row.id), undefined);
  const other = insertEvent("g1", { ...baseInput(), messageId: "m1" });
  updateEventMessage(other.id, "m2");
  assert.equal(getEvent(other.id)!.message_id, "m2");
  detachEventMessage("m2");
  assert.equal(getEvent(other.id)!.message_id, null);
});

test("applyEventRole and sendReminderDm are no-ops without a token", async () => {
  delete process.env.DISCORD_TOKEN;
  const row = insertEvent("g1", baseInput());
  await events.applyEventRole("g1", "u1", row.event_role_id, true);
  assert.equal(await events.sendReminderDm("u1", row), false);
});