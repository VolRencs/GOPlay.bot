import { db } from "../../db/database.ts";
import { ttlCacheSync } from "../cache.ts";
import type { Bi } from "./core.ts";
import type { Locale } from "./core.ts";

const guildLangStmt = db.prepare("SELECT lang FROM guilds WHERE id=?");
const langCache = ttlCacheSync<string, Locale>((guildId) => {
  const row = guildLangStmt.get(guildId) as { lang?: string } | undefined;
  return row?.lang === "en" ? "en" : "ru";
}, 10_000);

export function guildLang(guildId: string): Locale {
  return langCache.get(guildId);
}

export function invalidateGuildLang(guildId: string): void {
  langCache.delete(guildId);
}

export function makeTr<M extends Record<string, Bi>>(messages: M) {
  return (lang: Locale, key: keyof M & string, vars?: Record<string, string | number>): string => {
    let text = messages[key]?.[lang] ?? messages[key]?.ru ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
    return text;
  };
}

// Готовый переводчик на guildId: заменяет копии `(k, v) => trX(guildLang(id), k, v)`
// в обработчиках бота. guildLang кэширован (10 c), так что вызов дешёвый.
export function guildTr<K extends string>(tr: (lang: Locale, key: K, vars?: Record<string, string | number>) => string, guildId: string) {
  return (key: K, vars?: Record<string, string | number>): string => tr(guildLang(guildId), key, vars);
}

export const tempTr = makeTr({
  genericError: { ru: "❌ Произошла ошибка. Попробуйте ещё раз.", en: "❌ An error occurred. Please try again." },
  panelTitle: { ru: "Управление каналом", en: "Channel controls" },
  panelDesc: { ru: "Вы владелец этого временного канала. Используйте кнопки ниже, чтобы настроить его.", en: "You own this temporary channel. Use the buttons below to configure it." },
  btnRename: { ru: "Переименовать", en: "Rename" },
  btnLimit: { ru: "Лимит участников", en: "Member limit" },
  btnLock: { ru: "Закрыть / открыть", en: "Lock / unlock" },
  btnAllow: { ru: "Разрешить вход", en: "Allow join" },
  btnDeny: { ru: "Запретить вход", en: "Deny join" },
  btnTransfer: { ru: "Передать владение", en: "Transfer ownership" },
  btnDelete: { ru: "Удалить канал", en: "Delete channel" },
  notOwner: { ru: "Только владелец канала может управлять им.", en: "Only the channel owner can manage it." },
  renameDisabled: { ru: "Переименование каналов отключено на сервере.", en: "Channel renaming is disabled on this server." },
  accessDisabled: { ru: "Управление доступом отключено на сервере.", en: "Access control is disabled on this server." },
  closeDisabled: { ru: "Закрытие каналов отключено на сервере.", en: "Channel locking is disabled on this server." },
  manageDisabled: { ru: "Управление каналом отключено на сервере.", en: "Channel management is disabled on this server." },
  channelOpened: { ru: "Канал открыт.", en: "Channel unlocked." },
  channelClosed: { ru: "Канал закрыт.", en: "Channel locked." },
  deleting: { ru: "Канал удаляется.", en: "Deleting channel." },
  emptyName: { ru: "Название не может быть пустым.", en: "Name cannot be empty." },
  renamed: { ru: "Канал переименован в «{name}».", en: "Channel renamed to \"{name}\"." },
  limitRange: { ru: "Лимит должен быть числом от 0 до 99.", en: "Limit must be a number from 0 to 99." },
  limitSet: { ru: "Лимит установлен: {n} участников.", en: "Limit set: {n} members." },
  limitOff: { ru: "Лимит снят.", en: "Limit removed." },
  badUser: { ru: "Укажите корректного пользователя.", en: "Specify a valid user." },
  userNotFound: { ru: "Пользователь не найден на сервере.", en: "User not found on this server." },
  userAllowed: { ru: "<@{id}> получил доступ.", en: "<@{id}> has been granted access." },
  userDenied: { ru: "Доступ для <@{id}> закрыт.", en: "Access for <@{id}> has been revoked." },
  alreadyOwner: { ru: "Это уже владелец канала.", en: "This user is already the owner." },
  targetHasOwnChannel: { ru: "Этот пользователь уже владеет другим временным каналом.", en: "This user already owns another temporary channel." },
  transferred: { ru: "Владение каналом передано <@{id}>.", en: "Channel ownership transferred to <@{id}>." },
  modalRenameTitle: { ru: "Переименовать канал", en: "Rename channel" },
  modalNameLabel: { ru: "Название", en: "Name" },
  modalLimitTitle: { ru: "Лимит участников", en: "Member limit" },
  modalLimitLabel: { ru: "Лимит (0 — без лимита)", en: "Limit (0 = unlimited)" },
  modalAllowTitle: { ru: "Разрешить вход", en: "Allow join" },
  modalDenyTitle: { ru: "Запретить вход", en: "Deny join" },
  modalTransferTitle: { ru: "Передать владение", en: "Transfer ownership" },
  modalNewOwnerLabel: { ru: "Новый владелец (@упоминание или ID)", en: "New owner (@mention or ID)" },
  modalUserPh: { ru: "Пользователь (@упоминание или ID)", en: "User (@mention or ID)" },
});

export const automodTr = makeTr({
  roleUpdateFail: { ru: "❌ Не удалось обновить роль.", en: "❌ Failed to update the role." },
  reason: { ru: "Автомодерация: {rule}", en: "AutoMod: {rule}" },
  protectedAdminOnly: { ru: "Защищённый канал: сообщения разрешены только администраторам", en: "Protected channel: only administrators may send messages here" },
  protectedWiped: { ru: "Защищённый канал: сообщение удалено, сообщения за 24 часа стёрты, пользователь заблокирован", en: "Protected channel: message deleted, last 24h wiped, user banned" },
  protectedWipedFailed: { ru: "Защищённый канал: сообщение удалено, сообщения за 24 часа стёрты, бан не применён (не хватило прав)", en: "Protected channel: message deleted, last 24h wiped, ban not applied (insufficient permissions)" },
  roleUnavailable: { ru: "❌ Эта роль недоступна.", en: "❌ This role is unavailable." },
  roleLimitReached: { ru: "❌ Достигнут лимит ролей: {n}.", en: "❌ Role limit reached: {n}." },
  roleGiven: { ru: "✅ Выдана роль **{role}**", en: "✅ Role **{role}** added" },
  roleRemoved: { ru: "❌ Роль **{role}** снята", en: "❌ Role **{role}** removed" },
  genericError: { ru: "❌ Произошла ошибка. Попробуйте ещё раз.", en: "❌ An error occurred. Please try again." },
});

export const eventsTr = makeTr({
  notFound: { ru: "Событие не найдено.", en: "Event not found." },
  waitlisted: { ru: "✅ Вы в очереди на это событие.", en: "✅ You are on the waitlist for this event." },
  alreadyJoined: { ru: "ℹ️ Вы уже записаны на это событие.", en: "ℹ️ You are already signed up for this event." },
  joined: { ru: "✅ Вы записаны на событие!", en: "✅ You are signed up!" },
  notRegistered: { ru: "ℹ️ Вы не были записаны на это событие.", en: "ℹ️ You were not signed up for this event." },
  leftWaitlist: { ru: "✅ Вы покинули очередь.", en: "✅ You have left the waitlist." },
  leftPromoted: { ru: "✅ Вы отказались от участия. Освободившееся место занял участник из очереди.", en: "✅ You declined. A waitlisted participant took your spot." },
  left: { ru: "✅ Вы отказались от участия.", en: "✅ You have declined." },
  fldDate: { ru: "🕒 Дата", en: "🕒 Date" },
  fldStatus: { ru: "Статус", en: "Status" },
  fldParticipants: { ru: "👥 Участники", en: "👥 Participants" },
  fldWaitlist: { ru: "⏳ Очередь", en: "⏳ Waitlist" },
  joinedOf: { ru: "{a} из {b}", en: "{a} of {b}" },
  evAlreadyLive: { ru: "Событие уже началось, регистрация закрыта.", en: "The event has already started; registration is closed." },
  evRegClosed: { ru: "Регистрация на это событие закрыта.", en: "Registration for this event is closed." },
  evRegDisabled: { ru: "Регистрация на это событие отключена.", en: "Registration for this event is disabled." },
  evFull: { ru: "Все места заняты.", en: "All spots are taken." },
  reminderTitle: { ru: "Напоминание о событии", en: "Event reminder" },
  onServer: { ru: "на сервере «{s}»", en: "on \"{s}\"" },
  defaultEventWord: { ru: "Событие", en: "Event" },
});

export const commandsTr = makeTr({
  helpTitle: { ru: "Команды бота", en: "Bot commands" },
  accountCreated: { ru: "Аккаунт создан", en: "Account created" },
  joinedAt: { ru: "Присоединился", en: "Joined" },
  serverOwner: { ru: "Владелец", en: "Owner" },
  membersCount: { ru: "Участников", en: "Members" },
  createdAt: { ru: "Создан", en: "Created" },
  channelsCount: { ru: "Каналы", en: "Channels" },
  boostsCount: { ru: "Бустов", en: "Boosts" },
  channelsFormat: { ru: "{t} текстовых · {v} голосовых", en: "{t} text · {v} voice" },
  rolesField: { ru: "Роли", en: "Roles" },
  helpCommand: { ru: "**/{name}** — {desc}", en: "**/{name}** — {desc}" },
});
