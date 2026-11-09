import { BarChart3, CalendarDays, Gavel, History, Image, Medal, Mic2, Music, ScrollText, Settings, ShieldCheck, Sparkles, Tags, type LucideIcon } from "lucide-react";

export type TabKey = "stats" | "welcome" | "automod" | "roles" | "levels" | "embeds" | "music" | "events" | "logging" | "tempchannels" | "appeals" | "audit" | "settings";

export type TabMeta = {
  nav: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

export const TAB_META: Record<TabKey, TabMeta> = {
  stats: { nav: "Статистика", title: "Статистика сервера", description: "Активность, участники и действия модерации за выбранный период.", icon: BarChart3 },
  welcome: { nav: "Приветствие", title: "Приветствие", description: "Текст, оформление и персональная картинка для входа и прощания.", icon: Sparkles },
  automod: { nav: "Автомодерация", title: "Автомодерация", description: "Правила против спама и ссылок, исключения и защищённый канал.", icon: ShieldCheck },
  roles: { nav: "Роли", title: "Самовыдача ролей", description: "Панели с кнопками, меню и реакциями, а также автороль при входе.", icon: Tags },
  levels: { nav: "Уровни", title: "Уровни и опыт", description: "Начисление XP, награды за уровни и уведомления о повышении.", icon: Medal },
  embeds: { nav: "Embeds", title: "Конструктор embeds", description: "Шаблоны сообщений, медиа и публикация в каналы сервера.", icon: Image },
  music: { nav: "Музыка", title: "Музыка", description: "Доступ к /play, разрешённые каналы и автовыход плеера.", icon: Music },
  events: { nav: "События", title: "События", description: "Ивенты, регистрация, очередь ожидания и напоминания участникам.", icon: CalendarDays },
  logging: { nav: "Логи", title: "Логирование", description: "Канал журнала и категории событий, которые нужно записывать.", icon: ScrollText },
  tempchannels: { nav: "Временные каналы", title: "Временные каналы", description: "Шаблоны приватных голосовых комнат и права их владельцев.", icon: Mic2 },
  appeals: { nav: "Апелляции", title: "Апелляции", description: "Оспаривание наказаний, комментарии модераторов и статусы.", icon: Gavel },
  audit: { nav: "Журнал изменений", title: "Журнал изменений", description: "Кто и когда менял настройки сервера в панели.", icon: History },
  settings: { nav: "Настройки", title: "Настройки", description: "Язык бота и очистка данных сервера.", icon: Settings },
};

export const TAB_GROUPS: readonly { label: string; keys: readonly TabKey[] }[] = [
  { label: "Обзор", keys: ["stats", "audit", "settings"] },
  { label: "Сообщество", keys: ["welcome", "roles", "levels", "events"] },
  { label: "Модерация", keys: ["automod", "logging", "appeals", "tempchannels"] },
  { label: "Контент", keys: ["embeds", "music"] },
];

export function isTabKey(value: string): value is TabKey {
  return Object.hasOwn(TAB_META, value);
}
