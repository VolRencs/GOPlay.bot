import { stmt } from "../db/statements.ts";
import { langQueries } from "../db/queries.ts";
import { levelRewardsFor, levelSettingsFromRow } from "./levels-store.ts";
import type { NotifyMode } from "./levels.ts";
import { toDto as toLevelsDto, type LevelsDto } from "../contracts/levels.ts";
import { toDto, welcomeDefaults, type WelcomeDto } from "../contracts/welcome.ts";
import { logKeys, logTitleFor } from "./labels.ts";
import { fromDto as fromLoggingDto, type LoggingDto } from "../contracts/logging.ts";
import { safeJson, stableJson } from "./json.ts";
import { channelRef, roleRef } from "./mentions.ts";
import { formatLeaveAfter } from "./format.ts";
import { toDto as toMusicDto, type MusicDto } from "../contracts/music.ts";
import { musicSettingsFromRow } from "./music-settings.ts";
import { toDto as toAutoroleDto, type AutoroleDto } from "../contracts/autorole.ts";

export function autoroleState(guildId: string): { state: AutoroleDto; exists: boolean } {
  const row = stmt.autoroleSettings.get(guildId);
  return { state: toAutoroleDto({ enabled: row?.enabled ?? 0, role_id: row?.role_id ?? null }), exists: Boolean(row) };
}

export const autoroleView = (state: AutoroleDto) => ({
  "Включено": state.enabled,
  "Роль": state.roleId ? roleRef(state.roleId) : null,
});

export function langState(guildId: string): { state: string; exists: boolean } {
  const row = langQueries.get.get(guildId);
  return { state: row?.lang ?? "ru", exists: Boolean(row) };
}

export const langView = (lang: string) => ({
  "Язык": lang === "en" ? "английский" : lang === "ru" ? "русский" : lang,
});

export function loggingState(guildId: string): { state: LoggingDto; exists: boolean } {
  const row = stmt.loggingSettings.get(guildId);
  if (!row) return { state: fromLoggingDto({}), exists: false };
  return { state: fromLoggingDto({ channelId: row.channel_id, categories: safeJson<Record<string, boolean>>(row.categories_json, {}) }), exists: true };
}

export const loggingView = (state: LoggingDto) => ({
  "Канал": state.channelId ? channelRef(state.channelId) : null,
  "Включённые категории": logKeys.filter(key => Boolean(state.categories[key])).map(key => logTitleFor("ru", key)),
});

export function musicState(guildId: string): { state: MusicDto; exists: boolean } {
  const row = stmt.musicSettings.get(guildId);
  return { state: toMusicDto(musicSettingsFromRow(row)), exists: Boolean(row) };
}

export const musicView = (state: MusicDto) => ({
  "Канал команд": state.commandChannelId ? channelRef(state.commandChannelId) : null,
  "Голосовые каналы": state.voiceChannelIds.map(channelRef),
  "Разрешённые роли": state.allowedRoleIds.map(roleRef),
  "Плейлисты": state.playlistsEnabled,
  "Роли плейлистов": state.playlistRoleIds.map(roleRef),
  "Автовыход": formatLeaveAfter(state.leaveAfterSeconds),
});

const notifyModeLabels: Record<NotifyMode, string> = { off: "выключены", dm: "в личные сообщения", channel: "в канал" };

export function levelsState(guildId: string): { state: LevelsDto; exists: boolean } {
  const row = stmt.levelSettings.get(guildId);
  return {
    state: toLevelsDto({ settings: levelSettingsFromRow(row), rewards: levelRewardsFor(guildId) }),
    exists: Boolean(row),
  };
}

export const levelsView = (state: LevelsDto) => ({
  "Система уровней": state.settings.enabled,
  "XP за сообщение": state.settings.xpPerMessage,
  "Кулдаун сообщений, с": state.settings.messageCooldownSeconds,
  "Мин. длина сообщения": state.settings.minMessageLength,
  "XP за минуту голоса": state.settings.xpPerVoiceMinute,
  "Базовый XP": state.settings.baseXp,
  "Рост, %": state.settings.growthPercent,
  "Исключённые каналы": state.settings.ignoredChannelIds.map(channelRef),
  "Исключённые роли": state.settings.ignoredRoleIds.map(roleRef),
  "Уведомления": notifyModeLabels[state.settings.notifyMode],
  "Канал уведомлений": state.settings.notifyChannelId ? channelRef(state.settings.notifyChannelId) : null,
  "Награды": state.rewards.map(reward => `ур. ${reward.level} → ${roleRef(reward.roleId)}`),
});

export function welcomeState(guildId: string): { state: WelcomeDto; exists: boolean } {
  const row = stmt.welcomeSettings.get(guildId);
  if (!row) return { state: { ...welcomeDefaults }, exists: false };
  return { state: toDto(row), exists: true };
}

export const welcomeView = (state: WelcomeDto) => ({
  "Режим приветствия": state.enabled,
  "Канал приветствия": state.channelId ? channelRef(state.channelId) : null,
  "Текст приветствия": state.message,
  "Персональная картинка": state.imageEnabled,
  "Настройки картинки": stableJson(state.imageConfig),
  "Режим прощания": state.goodbyeEnabled,
  "Канал прощания": state.goodbyeChannelId ? channelRef(state.goodbyeChannelId) : null,
  "Текст прощания": state.goodbyeMessage,
});
