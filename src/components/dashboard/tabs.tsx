"use client";

import { lazy, type ComponentType } from "react";
import { BarChart3, CalendarDays, Gavel, History, Image, Medal, Mic2, Music, ScrollText, Settings, ShieldCheck, Sparkles, Tags, type LucideIcon } from "lucide-react";

const StatsTab = lazy(() => import("./StatsPanel.tsx").then(module => ({ default: module.ServerStatistics })));
const WelcomeTab = lazy(() => import("./WelcomePanel.tsx").then(module => ({ default: module.WelcomeSettings })));
const AutomodTab = lazy(() => import("./AutomodTab.tsx").then(module => ({ default: module.AutomodTab })));
const RolesTab = lazy(() => import("./RolesTab.tsx").then(module => ({ default: module.RolesTab })));
const LevelsTab = lazy(() => import("./LevelsPanel.tsx").then(module => ({ default: module.LevelsPanel })));
const EmbedsTab = lazy(() => import("./EmbedsPanel.tsx").then(module => ({ default: module.EmbedsPanel })));
const MusicTab = lazy(() => import("./MusicSettingsCard.tsx").then(module => ({ default: module.MusicSettingsCard })));
const EventsTab = lazy(() => import("./EventsPanel.tsx").then(module => ({ default: module.EventsPanel })));
const LoggingTab = lazy(() => import("./LoggingPanel.tsx").then(module => ({ default: module.LoggingSettings })));
const TempChannelsTab = lazy(() => import("./TempChannelsPanel.tsx").then(module => ({ default: module.TemporaryChannelsSettings })));
const AppealsTab = lazy(() => import("./AppealsPanel.tsx").then(module => ({ default: module.AppealsPanel })));
const AuditTab = lazy(() => import("./AuditPanel.tsx").then(module => ({ default: module.DashboardAuditLog })));
const SettingsTab = lazy(() => import("./SettingsTab.tsx").then(module => ({ default: module.SettingsTab })));

export type TabKey = "stats" | "welcome" | "automod" | "roles" | "levels" | "embeds" | "music" | "events" | "logging" | "tempchannels" | "appeals" | "audit" | "settings";

type TabDefinition = {
  nav: string;
  title: string;
  description: string;
  icon: LucideIcon;
  component: ComponentType;
};

export const TAB_DEFS: Record<TabKey, TabDefinition> = {
  stats: { nav: "Статистика", title: "Статистика сервера", description: "Активность, участники и действия модерации за выбранный период.", icon: BarChart3, component: StatsTab },
  welcome: { nav: "Приветствие", title: "Приветствие", description: "Текст, оформление и персональная картинка для входа и прощания.", icon: Sparkles, component: WelcomeTab },
  automod: { nav: "Автомодерация", title: "Автомодерация", description: "Правила против спама и ссылок, исключения и защищённый канал.", icon: ShieldCheck, component: AutomodTab },
  roles: { nav: "Роли", title: "Самовыдача ролей", description: "Панели с кнопками, меню и реакциями, а также автороль при входе.", icon: Tags, component: RolesTab },
  levels: { nav: "Уровни", title: "Уровни и опыт", description: "Начисление XP, награды за уровни и уведомления о повышении.", icon: Medal, component: LevelsTab },
  embeds: { nav: "Embeds", title: "Конструктор embeds", description: "Шаблоны сообщений, медиа и публикация в каналы сервера.", icon: Image, component: EmbedsTab },
  music: { nav: "Музыка", title: "Музыка", description: "Доступ к /play, разрешённые каналы и автовыход плеера.", icon: Music, component: MusicTab },
  events: { nav: "События", title: "События", description: "Ивенты, регистрация, очередь ожидания и напоминания участникам.", icon: CalendarDays, component: EventsTab },
  logging: { nav: "Логи", title: "Логирование", description: "Канал журнала и категории событий, которые нужно записывать.", icon: ScrollText, component: LoggingTab },
  tempchannels: { nav: "Временные каналы", title: "Временные каналы", description: "Шаблоны приватных голосовых комнат и права их владельцев.", icon: Mic2, component: TempChannelsTab },
  appeals: { nav: "Апелляции", title: "Апелляции", description: "Оспаривание наказаний, комментарии модераторов и статусы.", icon: Gavel, component: AppealsTab },
  audit: { nav: "Журнал изменений", title: "Журнал изменений", description: "Кто и когда менял настройки сервера в панели.", icon: History, component: AuditTab },
  settings: { nav: "Настройки", title: "Настройки", description: "Язык бота и очистка данных сервера.", icon: Settings, component: SettingsTab },
};

export const TAB_GROUPS: readonly { label: string; keys: readonly TabKey[] }[] = [
  { label: "Обзор", keys: ["stats", "audit", "settings"] },
  { label: "Сообщество", keys: ["welcome", "roles", "levels", "events"] },
  { label: "Модерация", keys: ["automod", "logging", "appeals", "tempchannels"] },
  { label: "Контент", keys: ["embeds", "music"] },
];

export function isTabKey(value: string): value is TabKey {
  return value in TAB_DEFS;
}
