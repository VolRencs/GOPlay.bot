"use client";

import { lazy, type ComponentType } from "react";
import { TAB_META, type TabKey } from "./tab-meta.ts";

const StatsTab = lazy(() => import("./StatsPanel.tsx").then(module => ({ default: module.ServerStatistics })));
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

export { TAB_GROUPS, isTabKey } from "./tab-meta.ts";
export type { TabKey } from "./tab-meta.ts";

type TabDefinition = (typeof TAB_META)[TabKey] & {
  component: ComponentType;
};

export const TAB_DEFS: Record<TabKey, TabDefinition> = {
  stats: { ...TAB_META.stats, component: StatsTab },
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
