"use client";

import { lazy, type ComponentType } from "react";
import { BarChart3, CalendarDays, Gavel, History, Image, Medal, Mic2, Music, ScrollText, Settings, ShieldCheck, Sparkles, Tags, type LucideIcon } from "lucide-react";
import { ServerStatistics } from "./StatsPanel.tsx";

export type TabKey = "stats" | "welcome" | "automod" | "roles" | "levels" | "embeds" | "music" | "events" | "logging" | "tempchannels" | "appeals" | "audit" | "settings";
type TabMeta = { nav: string; title: string; description: string; icon: LucideIcon };
const TAB_META: Record<TabKey, TabMeta> = {
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
export function isTabKey(value: string): value is TabKey { return Object.hasOwn(TAB_META, value); }

const WelcomeTab = lazy(() => import("./WelcomePanel.tsx").then(module => ({ default: module.WelcomeSettings })));
const AutomodTab = lazy(() => import("./AutomodTab.tsx").then(module => ({ default: module.AutomodTab })));
const AutoroleTab = lazy(() => import("./AutorolePanel.tsx").then(module => ({ default: module.AutoroleSettings })));
const RolePanelTab = lazy(() => import("./RolesPanel.tsx").then(module => ({ default: module.RoleSettings })));
const LevelsTab = lazy(() => import("./LevelsPanel.tsx").then(module => ({ default: module.LevelsPanel })));
const EmbedsTab = lazy(() => import("./EmbedsPanel.tsx").then(module => ({ default: module.EmbedsPanel })));
const MusicTab = lazy(() => import("./MusicSettingsCard.tsx").then(module => ({ default: module.MusicSettingsCard })));
const EventsTab = lazy(() => import("./EventsPanel.tsx").then(module => ({ default: module.EventsPanel })));
const LoggingTab = lazy(() => import("./LoggingPanel.tsx").then(module => ({ default: module.LoggingSettings })));
const TempChannelsTab = lazy(() => import("./TempChannelsPanel.tsx").then(module => ({ default: module.TemporaryChannelsSettings })));
const AppealsTab = lazy(() => import("./AppealsPanel.tsx").then(module => ({ default: module.AppealsPanel })));
const AuditTab = lazy(() => import("./AuditPanel.tsx").then(module => ({ default: module.DashboardAuditLog })));
const BotLanguageTab = lazy(() => import("./BotLanguageCard.tsx").then(module => ({ default: module.BotLanguageCard })));
const CleanupTab = lazy(() => import("./AuditPanel.tsx").then(module => ({ default: module.ServerDataCleanup })));

function RolesTab() {
  return <section className="panel-stack"><AutoroleTab/><RolePanelTab/></section>;
}

function SettingsTab() {
  return <section className="panel-stack"><BotLanguageTab/><CleanupTab/></section>;
}

type TabDefinition = (typeof TAB_META)[TabKey] & {
  component: ComponentType;
};

export const TAB_DEFS: Record<TabKey, TabDefinition> = {
  stats: { ...TAB_META.stats, component: ServerStatistics },
  welcome: { ...TAB_META.welcome, component: WelcomeTab },
  automod: { ...TAB_META.automod, component: AutomodTab },
  roles: { ...TAB_META.roles, component: RolesTab },
  levels: { ...TAB_META.levels, component: LevelsTab },
  embeds: { ...TAB_META.embeds, component: EmbedsTab },
  music: { ...TAB_META.music, component: MusicTab },
  events: { ...TAB_META.events, component: EventsTab },
  logging: { ...TAB_META.logging, component: LoggingTab },
  tempchannels: { ...TAB_META.tempchannels, component: TempChannelsTab },
  appeals: { ...TAB_META.appeals, component: AppealsTab },
  audit: { ...TAB_META.audit, component: AuditTab },
  settings: { ...TAB_META.settings, component: SettingsTab },
};
