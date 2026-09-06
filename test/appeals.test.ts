import test from "node:test"; import assert from "node:assert/strict";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import type { Client } from "discord.js";

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "goplay-test-")), "bot.sqlite");
const { createAppeal, declineAppeal, reviewAppeal, listAppeals, applyAppealReversal, notifyAppealStatus, reversalFor } = await import("../src/lib/appeals.ts");
const { punishmentLabelsM: punishmentLabels } = await import("../src/lib/labels.ts");
const { db } = await import("../src/db/database.ts");
const { recordDashboardChange } = await import("../src/lib/dashboard-audit.ts");
const { stmt } = await import("../src/bot/db/statements.ts");
const { recordPunishmentAndOffer } = await import("../src/bot/moderation/index.ts");

for (const guildId of ["g1", "g2"]) db.prepare("INSERT OR IGNORE INTO guilds(id,name,icon,updated_at) VALUES(?,?,?,?)").run(guildId, guildId, null, Date.now());
const punishment = (id: number, guildId: string, userId: string, type: string) => db.prepare("INSERT INTO moderation_actions(id,guild_id,user_id,moderator_id,type,reason,created_at) VALUES(?,?,?,?,?,?,?)").run(id, guildId, userId, "mod", type, `${type} reason`, 1_000_000);
punishment(1, "g1", "u1", "ban");
punishment(2, "g1", "u1", "timeout");
punishment(3, "g1", "u2", "warn");
punishment(4, "g2", "u1", "ban");
punishment(5, "g1", "u1", "automod");
punishment(6, "g1", "u1", "untimeout");
punishment(7, "g1", "u1", "ban");
punishment(8, "g1", "u2", "warn");
punishment(9, "g1", "u1", "warn");
punishment(10, "g1", "u1", "ban");
punishment(13, "g1", "u1", "ban");


const withToken = async <T>(token: string, run: () => Promise<T>): Promise<T> => {
  const previous = process.env.DISCORD_TOKEN;
  process.env.DISCORD_TOKEN = token;
  try { return await run(); }
  finally { if (previous === undefined) delete process.env.DISCORD_TOKEN; else process.env.DISCORD_TOKEN = previous; }
};

test("create appeal: happy path copies the punishment type and starts pending", () => {
  const result = createAppeal({ guildId: "g1", userId: "u1", punishmentId: 1, reason: "Я не отправлял это сообщение." });
  assert.ok(result.ok);
  assert.equal(result.value.status, "pending");
  assert.equal(result.value.type, "ban");
  assert.equal(result.value.reason, "Я не отправлял это сообщение.");
  assert.equal(result.value.moderator_comment, null);
  assert.equal(result.value.reviewed_by, null);
});

test("create appeal rejects unknown, foreign and short-reason requests", () => {
  assert.equal(createAppeal({ guildId: "g1", userId: "u1", punishmentId: 999, reason: "Достаточно длинная причина" }).ok, false);
  assert.equal(createAppeal({ guildId: "g1", userId: "u1", punishmentId: 4, reason: "Достаточно длинная причина" }).ok, false, "наказание с другого сервера");
  assert.equal(createAppeal({ guildId: "g1", userId: "u1", punishmentId: 3, reason: "Достаточно длинная причина" }).ok, false, "чужое наказание");
  assert.equal(createAppeal({ guildId: "g1", userId: "u1", punishmentId: 2, reason: "коротк" }).ok, false, "слишком короткая причина");
  assert.equal(createAppeal({ guildId: "g1", userId: "u2", punishmentId: 1, reason: "Достаточно длинная причина" }).ok, false, "чужой наказанный");
});

test("one open appeal per punishment: service check and unique index", () => {
  const first = createAppeal({ guildId: "g1", userId: "u1", punishmentId: 2, reason: "Тайм-аут был несправедливым." });
  assert.ok(first.ok);
  const second = createAppeal({ guildId: "g1", userId: "u1", punishmentId: 2, reason: "Вторая попытка апелляции." });
  assert.equal(second.ok, false);
  assert.match((second as { error: string }).error, /#\d+/);
  assert.throws(() => db.prepare("INSERT INTO appeals(guild_id,user_id,punishment_id,type,reason,status,created_at,updated_at) VALUES('g1','u1',2,'timeout','прямая вставка','pending',1,1)").run(), /UNIQUE/i);
});

test("a finished appeal permanently blocks a new one", () => {
  const appeal = reviewAppeal({ guildId: "g1", appealId: 2, action: "rejected", reviewerId: "mod1", comment: "нет оснований" });
  assert.ok(appeal.ok);
  assert.equal(appeal.value.appeal.status, "rejected");
  const retry = createAppeal({ guildId: "g1", userId: "u1", punishmentId: 2, reason: "Апелляция после отклонения." });
  assert.equal(retry.ok, false, "после решения новая апелляция не создаётся");
});

test("status transitions follow the state machine", () => {
  const appeal = createAppeal({ guildId: "g1", userId: "u1", punishmentId: 5, reason: "Автомодерация сработала ошибочно." });
  assert.ok(appeal.ok);
  const reviewing = reviewAppeal({ guildId: "g1", appealId: appeal.value.id, action: "reviewing", reviewerId: "mod1" });
  assert.ok(reviewing.ok);
  assert.equal(reviewing.value.appeal.status, "reviewing");
  assert.equal(reviewing.value.appeal.reviewed_by, "mod1");
  assert.equal(reviewing.value.reversal, null, "нет отмены наказания при взятии в работу");
  assert.equal(reviewAppeal({ guildId: "g1", appealId: appeal.value.id, action: "reviewing", reviewerId: "mod1" }).ok, false, "повторное взятие запрещено");
  const approved = reviewAppeal({ guildId: "g1", appealId: appeal.value.id, action: "approved", reviewerId: "mod2", comment: "Ок, разблокирую." });
  assert.ok(approved.ok);
  assert.equal(approved.value.appeal.status, "approved");
  assert.equal(approved.value.appeal.moderator_comment, "Ок, разблокирую.");
  assert.equal(reviewAppeal({ guildId: "g1", appealId: appeal.value.id, action: "rejected", reviewerId: "mod1" }).ok, false, "терминальное состояние не меняется");
});

test("approval reversal matches the punishment type", () => {
  const ban = createAppeal({ guildId: "g1", userId: "u1", punishmentId: 7, reason: "Прошу снять бан, я исправлюсь." });
  assert.ok(ban.ok);
  const banApproved = reviewAppeal({ guildId: "g1", appealId: ban.value.id, action: "approved", reviewerId: "mod1" });
  assert.ok(banApproved.ok);
  assert.equal(banApproved.value.reversal, "unban");
  assert.equal(reversalFor("ban"), "unban");
  assert.equal(reversalFor("timeout"), "untimeout");
  assert.equal(reversalFor("warn"), null);
  assert.equal(reversalFor("kick"), null);
  assert.equal(reversalFor("automod"), null);
  assert.equal(reversalFor("untimeout"), null);
});

test("review rejects unknown appeals and appeals of other guilds", () => {
  assert.equal(reviewAppeal({ guildId: "g1", appealId: 9999, action: "approved", reviewerId: "mod1" }).ok, false);
  const appeal = createAppeal({ guildId: "g2", userId: "u1", punishmentId: 4, reason: "Кик был ошибкой модератора." });
  assert.ok(appeal.ok);
  const crossGuild = reviewAppeal({ guildId: "g1", appealId: appeal.value.id, action: "approved", reviewerId: "mod1" });
  assert.equal(crossGuild.ok, false);
  assert.equal((crossGuild as { status: number }).status, 404);
});

test("listAppeals supports status, user, moderator and date filters", () => {
  assert.ok(listAppeals({ guildId: "g1" }).length >= 4, "все апелляции сервера");
  assert.ok(listAppeals({ guildId: "g1", status: "pending" }).every(a => a.status === "pending"));
  assert.ok(listAppeals({ guildId: "g1", userId: "u2" }).every(a => a.user_id === "u2"));
  assert.ok(listAppeals({ guildId: "g1", moderatorId: "mod1" }).length > 0 && listAppeals({ guildId: "g1", moderatorId: "mod1" }).every(a => a.reviewed_by === "mod1"));
  assert.ok(listAppeals({ guildId: "g1", from: 2_000_000 }).every(a => a.created_at >= 2_000_000));
  assert.equal(listAppeals({ guildId: "g1", to: 1_500_000 }).length, 0, "все апелляции новее этого порога");
  assert.equal(listAppeals({ guildId: "g2", status: "approved" }).length, 0, "g1 не влияет на g2");
  const viewed = listAppeals({ guildId: "g1" })[0];
  assert.ok(viewed && "punishment_reason" in viewed && "punishment_created_at" in viewed, "список содержит данные наказания");
});

test("punishment reversal talks to Discord REST and swallows failures", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  await withToken("test-token", async () => {
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} }); return new Response(null, { status: 204 }); };
    try {
      const unban = await applyAppealReversal("ru", "g1", "u1", "unban");
      assert.equal(unban.ok, true);
      assert.match(calls[0]!.url, /\/guilds\/g1\/bans\/u1$/);
      assert.equal(calls[0]!.init.method, "DELETE");
      const unbanHeaders = calls[0]!.init.headers as Record<string, string>;
      assert.ok(!("content-type" in unbanHeaders) || !unbanHeaders["content-type"], "DELETE без тела не должен нести content-type");
      const untimeout = await applyAppealReversal("ru", "g1", "u1", "untimeout");
      assert.equal(untimeout.ok, true);
      assert.match(calls[1]!.url, /\/guilds\/g1\/members\/u1$/);
      assert.equal(calls[1]!.init.method, "PATCH");
      assert.ok(("content-type" in (calls[1]!.init.headers as Record<string, string>)), "PATCH с телом несёт content-type");
    } finally { globalThis.fetch = realFetch; }
    globalThis.fetch = async () => { throw new Error("network down"); };
    try { assert.equal((await applyAppealReversal("ru", "g1", "u1", "unban")).ok, false); }
    finally { globalThis.fetch = realFetch; }
  });
});

test("status DM: content is sent, failures never change the stored status", async () => {
  const created = createAppeal({ guildId: "g1", userId: "u1", punishmentId: 6, reason: "Несколько длинная причина апелляции." });
  assert.ok(created.ok);
  const taken = reviewAppeal({ guildId: "g1", appealId: created.value.id, action: "reviewing", reviewerId: "mod1" });
  assert.ok(taken.ok);
  const realFetch = globalThis.fetch;
  const bodies: { url: string; body: string }[] = [];
  await withToken("test-token", async () => {
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => { bodies.push({ url: String(url), body: String(init?.body ?? "") }); return new Response(String(url).includes("/messages") ? "{}" : '{"id":"ch1"}', { status: 200 }); };
    try {
      assert.equal(await notifyAppealStatus(taken.value.appeal), true);
      assert.match(bodies[0]!.url, /\/users\/u1\/channels$/);
      assert.match(bodies[0]!.body, /recipient_id/);
      assert.match(bodies[0]!.body, /"recipient_id":"u1"/);
      assert.match(bodies[1]!.body, /Апелляция #\d+.*взята в работу/);
      const rejected = reviewAppeal({ guildId: "g1", appealId: created.value.id, action: "rejected", reviewerId: "mod1", comment: "Причина не подтвердилась." });
      assert.ok(rejected.ok);
      assert.equal(await notifyAppealStatus(rejected.value.appeal), true);
      assert.match(bodies[3]!.body, /Комментарий модератора: Причина не подтвердилась\./);
    } finally { globalThis.fetch = realFetch; }
    globalThis.fetch = async () => { throw new Error("dm blocked"); };
    try {
      const pending = createAppeal({ guildId: "g1", userId: "u2", punishmentId: 8, reason: "Достаточно длинная причина." });
      assert.ok(pending.ok);
      assert.equal(await notifyAppealStatus(pending.value), false);
      const row = db.prepare("SELECT status FROM appeals WHERE id=?").get(pending.value.id) as { status: string };
      assert.equal(row.status, "pending", "ошибка DM не меняет состояние");
    } finally { globalThis.fetch = realFetch; }
  });
});

test("declineAppeal closes the punishment for appeals forever", () => {
  const declined = declineAppeal({ guildId: "g1", userId: "u1", punishmentId: 10 });
  assert.ok(declined.ok);
  assert.ok(declined.value);
  assert.equal(declined.value.status, "declined");
  assert.equal(declined.value.reason, "Пользователь отказался от апелляции");
  const again = declineAppeal({ guildId: "g1", userId: "u1", punishmentId: 10 });
  assert.ok(again.ok);
  assert.equal(again.value, null, "повторный клик не создаёт дубль");
  const appeal = createAppeal({ guildId: "g1", userId: "u1", punishmentId: 10, reason: "Я передумал, хочу апелляцию." });
  assert.equal(appeal.ok, false);
  assert.match((appeal as { error: string }).error, /отказались/);
  assert.equal(declineAppeal({ guildId: "g1", userId: "u2", punishmentId: 10 }).ok, false, "чужой не может отказаться");
  assert.equal(declineAppeal({ guildId: "g1", userId: "u1", punishmentId: 999 }).ok, false, "несуществующее наказание");
});

test("declined appeals are listed and cannot be reviewed", () => {
  const rows = listAppeals({ guildId: "g1", status: "declined" });
  assert.ok(rows.length >= 1);
  assert.ok(rows.every(a => a.status === "declined"));
  assert.ok(rows[0] && "punishment_reason" in rows[0], "список содержит данные наказания");
  const reviewed = reviewAppeal({ guildId: "g1", appealId: rows[0]!.id, action: "approved", reviewerId: "mod1" });
  assert.equal(reviewed.ok, false, "declined нельзя обработать");
});

test("review is recorded in the dashboard audit log", () => {
  const appeal = createAppeal({ guildId: "g1", userId: "u1", punishmentId: 9, reason: "Достаточно длинная причина." });
  assert.ok(appeal.ok);
  const reviewed = reviewAppeal({ guildId: "g1", appealId: appeal.value.id, action: "closed", reviewerId: "mod1" });
  assert.ok(reviewed.ok);
  recordDashboardChange("g1", { id: "mod1", name: "Модератор" }, "Апелляции", `Апелляция #${appeal.value.id}: статус «Закрыта»`);
  const entry = db.prepare("SELECT section,summary FROM dashboard_audit WHERE guild_id='g1' ORDER BY created_at DESC LIMIT 1").get() as { section: string; summary: string };
  assert.equal(entry.section, "Апелляции");
  assert.match(entry.summary, /Апелляция #\d+/);
});

test("an approved warn appeal removes the warn from the warnings list", () => {
  punishment(11, "g1", "u2", "warn");
  punishment(12, "g1", "u2", "warn");
  const before = (stmt.warns.all("g1", "u2") as { reason: string }[]).length;
  const appeal = createAppeal({ guildId: "g1", userId: "u2", punishmentId: 11, reason: "Достаточно длинная причина." });
  assert.ok(appeal.ok);
  assert.equal((stmt.warns.all("g1", "u2") as { reason: string }[]).length, before, "pending-апелляция не влияет на список");
  assert.ok(reviewAppeal({ guildId: "g1", appealId: appeal.value.id, action: "approved", reviewerId: "mod1" }).ok);
  assert.equal((stmt.warns.all("g1", "u2") as { reason: string }[]).length, before - 1, "одобренная апелляция убирает warn из списка");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM moderation_actions WHERE id=11 AND type='warn'").get() as { count: number }).count, 1, "запись наказания остаётся в БД для истории");
});

test("recordPunishmentAndOffer writes the row and offers only for punishable types", () => {
  const sent: { userId: string; content: string }[] = [];
  const fakeClient = { users: { send: async (userId: string, payload: { content: string }) => { sent.push({ userId, content: payload.content }); return null; } } } as unknown as Client;
  recordPunishmentAndOffer(fakeClient, { guildId: "g1", guildName: "g1", userId: "u2", type: "timeout", reason: "ручной тайм-аут", moderatorId: null });
  const row = db.prepare("SELECT * FROM moderation_actions WHERE guild_id='g1' AND user_id='u2' AND type='timeout' AND reason='ручной тайм-аут'").get() as { id: number; moderator_id: string | null };
  assert.ok(row, "строка наказания записана");
  assert.equal(row.moderator_id, null);
  assert.equal(sent.length, 1, "оффер отправлен");
  assert.match(sent[0]!.content, /Тайм-аут/);
  recordPunishmentAndOffer(fakeClient, { guildId: "g1", guildName: "g1", userId: "u2", type: "kick", reason: "ручной кик", moderatorId: null });
  assert.equal(sent.length, 1, "кик не предлагает апелляцию");
  assert.ok(db.prepare("SELECT COUNT(*) AS count FROM moderation_actions WHERE guild_id='g1' AND user_id='u2' AND type='kick' AND reason='ручной кик'").get(), "кик всё равно записывается");
  recordPunishmentAndOffer(fakeClient, { guildId: "g1", guildName: "g1", userId: "u2", type: "untimeout", reason: "снят", moderatorId: "mod1" });
  assert.equal(sent.length, 1, "untimeout не предлагает апелляцию");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM moderation_actions WHERE guild_id='g1' AND user_id='u2' AND type='untimeout'").get() as { count: number }).count, 1, "untimeout всё равно записывается");
});

test("decision DM carries the outcome, punishment info and moderator comment", async () => {
  const appeal = createAppeal({ guildId: "g1", userId: "u1", punishmentId: 13, reason: "Прошу пересмотреть бан." });
  assert.ok(appeal.ok);
  const approved = reviewAppeal({ guildId: "g1", appealId: appeal.value.id, action: "approved", reviewerId: "mod1", comment: "Ошибка модератора, снимаю." });
  assert.ok(approved.ok);
  const realFetch = globalThis.fetch;
  const bodies: { url: string; body: string }[] = [];
  await withToken("test-token", async () => {
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => { bodies.push({ url: String(url), body: String(init?.body ?? "") }); return new Response(String(url).includes("/messages") ? "{}" : '{"id":"ch1"}', { status: 200 }); };
    try {
      assert.equal(await notifyAppealStatus(approved.value.appeal, { ok: true, label: "Бан" }), true);
      const sent = bodies[1]!.body;
      assert.match(sent, /одобрена/);
      assert.match(sent, /Наказание: \*\*Бан\*\*/);
      assert.match(sent, /Снят: Бан\./);
      assert.match(sent, /Ваша причина: Прошу пересмотреть бан\./);
      assert.match(sent, /Комментарий модератора: Ошибка модератора, снимаю\./);
    } finally { globalThis.fetch = realFetch; }
  });
});

test("punishment labels cover every moderation action type", () => {
  for (const type of ["warn", "timeout", "kick", "ban", "untimeout", "automod"]) assert.ok(punishmentLabels[type]?.ru, type);
});