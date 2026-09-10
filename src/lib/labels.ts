// Подписи панели в одном месте (роуты + страница): сервер и клиент физически
// не могут разойтись в названиях правил, событий, целей очистки и статусов.

import type { Bi, Locale } from "./i18n/core.ts";

export const punishmentLabelsM: Record<string, Bi> = {
  warn: { ru: "Предупреждение", en: "Warning" },
  timeout: { ru: "Тайм-аут", en: "Timeout" },
  kick: { ru: "Кик", en: "Kick" },
  ban: { ru: "Бан", en: "Ban" },
  untimeout: { ru: "Снятие тайм-аута", en: "Timeout removal" },
  automod: { ru: "Автомодерация", en: "AutoMod" },
};
export const punishmentLabels: Record<string, string> = Object.fromEntries(Object.entries(punishmentLabelsM).map(([k, v]) => [k, v.ru]));
export const punishmentLabel = (lang: Locale, key: string): string => punishmentLabelsM[key]?.[lang] ?? key;

const moderationLabelsM: Record<string, Bi> = {
  warn: { ru: "Предупреждения", en: "Warnings" },
  timeout: { ru: "Тайм-ауты", en: "Timeouts" },
  kick: { ru: "Кики", en: "Kicks" },
  ban: { ru: "Баны", en: "Bans" },
  untimeout: { ru: "Снятие тайм-аута", en: "Timeout removals" },
  automod: { ru: "Автомодерация", en: "AutoMod" },
};
export const moderationLabel = (lang: Locale, key: string): string => moderationLabelsM[key]?.[lang] ?? key;

const appealStatusMetaM: Record<string, { label: Bi }> = {
  pending: { label: { ru: "Ожидает", en: "Pending" } },
  reviewing: { label: { ru: "На рассмотрении", en: "Reviewing" } },
  approved: { label: { ru: "Одобрена", en: "Approved" } },
  rejected: { label: { ru: "Отклонена", en: "Rejected" } },
  closed: { label: { ru: "Закрыта", en: "Closed" } },
  declined: { label: { ru: "Отказался пользователь", en: "Declined by user" } },
};
export const appealStatusMeta: Record<string, { label: string }> = Object.fromEntries(Object.entries(appealStatusMetaM).map(([k, v]) => [k, { label: v.label.ru }]));

export const eventStatusMetaM: Record<string, { label: Bi }> = {
  scheduled: { label: { ru: "Запланировано", en: "Scheduled" } },
  live: { label: { ru: "Идёт сейчас", en: "Live now" } },
  completed: { label: { ru: "Завершено", en: "Completed" } },
  cancelled: { label: { ru: "Отменено", en: "Cancelled" } },
};
export const eventStatusMeta: Record<string, { label: string }> = Object.fromEntries(Object.entries(eventStatusMetaM).map(([k, v]) => [k, { label: v.label.ru }]));

export const automodRulesM: Record<string, { title: Bi; description: Bi }> = {
  spam: { title: { ru: "Флуд", en: "Flooding" }, description: { ru: "Повторяющиеся сообщения за короткое время", en: "Repeated messages in a short time" } },
  duplicate: { title: { ru: "Дубликаты", en: "Duplicates" }, description: { ru: "Одинаковые сообщения подряд", en: "Identical messages in a row" } },
  caps: { title: { ru: "Caps Lock", en: "Caps Lock" }, description: { ru: "Слишком много заглавных букв", en: "Too many capital letters" } },
  emoji: { title: { ru: "Эмодзи-спам", en: "Emoji spam" }, description: { ru: "Избыточное количество эмодзи", en: "Excessive emoji usage" } },
  mentions: { title: { ru: "Массовые упоминания", en: "Mass mentions" }, description: { ru: "Много пользователей или ролей", en: "Many users or roles mentioned" } },
  invites: { title: { ru: "Discord-инвайты", en: "Discord invites" }, description: { ru: "Приглашения на серверы", en: "Server invite links" } },
  links: { title: { ru: "Ссылки", en: "Links" }, description: { ru: "Подозрительные или нежелательные ссылки", en: "Suspicious or unwanted links" } },
  links_only: { title: { ru: "Каналы только для ссылок", en: "Link-only channels" }, description: { ru: "В выбранных каналах можно отправлять только сообщения со ссылкой.", en: "Only messages with links are allowed in selected channels." } },
  media_only: { title: { ru: "Каналы только для медиа", en: "Media-only channels" }, description: { ru: "В выбранных каналах разрешены только фото, видео или оба типа.", en: "Only photos, videos or both are allowed in selected channels." } },
};
export const automodRulesFor = (lang: Locale): Record<string, { title: string; description: string }> =>
  Object.fromEntries(Object.entries(automodRulesM).map(([k, v]) => [k, { title: v.title[lang], description: v.description[lang] }]));
// Русский словарь — алиас над общей сборкой, не ручная копия.
export const automodRules: Record<string, { title: string; description: string }> = automodRulesFor("ru");

type LogGroup = { title: string; items: readonly (readonly [string, string, string, string])[] };
// Кортеж пункта: ключ, подпись-галочка панели, заголовок журнала (ru), (en).
// ключей не могут разъехаться.
export const logGroups: LogGroup[] = [
  { title: "Участники", items: [["member_join", "Присоединился к серверу", "Участник присоединился", "Member joined"], ["member_leave", "Покинул сервер", "Участник покинул сервер", "Member left"], ["member_roles", "Изменение ролей", "Роли участника изменены", "Member roles changed"], ["member_ban", "Участник забанен", "Участник забанен", "Member banned"], ["member_unban", "Участник разбанен", "Участник разбанен", "Member unbanned"], ["member_kick", "Участник исключён", "Участник исключён", "Member kicked"], ["member_timeout", "Тайм-аут выдан или снят", "Тайм-аут изменён", "Timeout changed"], ["member_warn", "Выдано предупреждение", "Предупреждение выдано", "Warning issued"], ["member_warn_clear", "Предупреждения сняты", "Предупреждения сняты", "Warnings cleared"]] },
  { title: "Сообщения", items: [["message_delete", "Сообщение удалено", "Сообщение удалено", "Message deleted"], ["message_edit", "Сообщение изменено", "Сообщение изменено", "Message edited"], ["message_purge", "Очистка канала (purge)", "Сообщения очищены", "Messages purged"]] },
  { title: "Сервер", items: [["channel_create", "Канал создан", "Канал создан", "Channel created"], ["channel_delete", "Канал удален", "Канал удалён", "Channel deleted"], ["automod", "Срабатывание автомодерации", "Автомодерация", "AutoMod"]] },
];
export const logKeys: readonly string[] = logGroups.flatMap(group => group.items.map(([key]) => key));
const logTitlesByLang: Record<Locale, Record<string, string>> = {
  ru: Object.fromEntries(logGroups.flatMap(group => group.items.map(([key, , title]) => [key, title]))),
  en: Object.fromEntries(logGroups.flatMap(group => group.items.map(([key, , , titleEn]) => [key, titleEn]))),
};
export const logTitleFor = (lang: Locale, type: string): string => logTitlesByLang[lang][type] ?? type;

export type CleanupTarget = "audit" | "appeals" | "warns" | "stats" | "events" | "music" | "levels";
// «Музыка» намеренно отсутствует в списке пользовательской очистки: это
// (см. WIPE_TARGETS в server-cleanup).
export const cleanupTargetsM: { key: CleanupTarget; label: Bi; description: Bi; confirm: Bi; done: Bi }[] = [
  { key: "audit", label: { ru: "Журнал изменений", en: "Change log" }, description: { ru: "Все записи о том, кто и что менял в настройках.", en: "All records of who changed what in settings." }, confirm: { ru: "Очистить журнал изменений? Это действие нельзя отменить.", en: "Clear the change log? This cannot be undone." }, done: { ru: "Журнал изменений очищен.", en: "Change log cleared." } },
  { key: "appeals", label: { ru: "Апелляции", en: "Appeals" }, description: { ru: "Все поданные апелляции и их история. Счётчик апелляций сервера начнётся заново.", en: "All filed appeals and their history. The server appeal counter restarts." }, confirm: { ru: "Удалить все апелляции сервера? Это действие нельзя отменить.", en: "Delete all server appeals? This cannot be undone." }, done: { ru: "Все апелляции сервера удалены.", en: "All server appeals deleted." } },
  { key: "warns", label: { ru: "Предупреждения", en: "Warnings" }, description: { ru: "Все предупреждения (warn) и связанные с ними апелляции.", en: "All warnings and their related appeals." }, confirm: { ru: "Удалить все предупреждения сервера? Это действие нельзя отменить.", en: "Delete all server warnings? This cannot be undone." }, done: { ru: "Все предупреждения сервера удалены.", en: "All server warnings deleted." } },
  { key: "stats", label: { ru: "Статистика", en: "Statistics" }, description: { ru: "Данные статистики: сообщения, участники, модерация за все периоды.", en: "Statistics data: messages, members, moderation for all periods." }, confirm: { ru: "Удалить статистику сервера? Это действие нельзя отменить.", en: "Delete server statistics? This cannot be undone." }, done: { ru: "Статистика сервера удалена.", en: "Server statistics deleted." } },
  { key: "levels", label: { ru: "Уровни и опыт", en: "Levels and XP" }, description: { ru: "Накопленный опыт и уровни всех участников. Настройки системы уровней и роли-награды сохранятся.", en: "Accumulated XP and levels of all members. Level settings and role rewards are kept." }, confirm: { ru: "Сбросить уровни и опыт всех участников? Это действие нельзя отменить.", en: "Reset all member levels and XP? This cannot be undone." }, done: { ru: "Уровни и опыт всех участников сброшены.", en: "All member levels and XP have been reset." } },
  { key: "events", label: { ru: "События", en: "Events" }, description: { ru: "Все события сервера, их участники и запланированные напоминания.", en: "All server events, participants and scheduled reminders." }, confirm: { ru: "Удалить все события сервера? Это действие нельзя отменить.", en: "Delete all server events? This cannot be undone." }, done: { ru: "Все события сервера удалены.", en: "All server events deleted." } },
];
export const cleanupTargets: { key: CleanupTarget; label: string; description: string; confirm: string; done: string }[] = cleanupTargetsM.map(t => ({ key: t.key, label: t.label.ru, description: t.description.ru, confirm: t.confirm.ru, done: t.done.ru }));

export type LoggingPutBody = {
  channelId: string | null;
  categories: Record<string, boolean>;
};

export function buildLoggingPutBody(s: { channelId: string; categories: Record<string, boolean> }): LoggingPutBody {
  return { channelId: s.channelId || null, categories: { ...s.categories } };
}

export type LoggingGet = { channel_id: string | null; categories_json: string };

export function clampMusicSeconds(seconds: number): number {
  return seconds === 0 ? 0 : Math.max(30, Math.min(3600, seconds));
}
