import { DEFAULT_SETTINGS } from "../../../src/lib/tempchannels.ts";
import type { MusicSettings } from "../../lib/music-settings.ts";
import { clampMusicSeconds, type LoggingPutBody } from "../../lib/labels.ts";
import type { AutomodRuleRow } from "../../lib/automod.ts";
export type Channel = { id: string; name: string };
export type Role = { id: string; name: string };
// Единые сигнатуры уведомлений панелей: успех с тоном и ошибка.
export type PanelNotify = (message: string, tone?: "ok" | "warn") => void;
export type PanelFail = (message: string) => void;
export type ServerEmoji = { id: string; name: string; animated: boolean; value: string };
export type ServerStats = { members: number | null; online: number | null };
export type ServerIdentity = { name: string; icon: string | null };
// enabled/escalation: из GET приходят как number (0/1 из SQLite),
// в PUT уходят как boolean. Тип допускает оба, конверсия — Boolean()/+ на границе.
export type Rule = Omit<AutomodRuleRow, "enabled" | "escalation"> & { enabled: number | boolean; escalation: number | boolean };
export type Welcome = { enabled: number | boolean; channel_id: string | null; message: string; image_enabled: number | boolean; background_path: string | null; image_config_json: string; goodbye_enabled: number | boolean; goodbye_channel_id: string | null; goodbye_message: string };
export type LoggingState = Omit<LoggingPutBody, "channelId"> & { channelId: string };
export type TempChannelConfig = { categoryId: string | null; nameTemplate: string; userLimit: number; canRename: boolean; canManageAccess: boolean; canClose: boolean };
export type TempPreset = { id: number; name: string; triggerChannelIds: string[]; config: TempChannelConfig };
export type TempChannelsState = { presets: TempPreset[] };
export type TempPresetApi = { id: number; name: string; triggerChannelIds: string[]; categoryId: string | null; nameTemplate: string; userLimit: number; canRename: boolean; canManageAccess: boolean; canClose: boolean };
export type EmbedSending = { id: number; embed_id: number; channel_id: string; message_id: string; sent_at: number };
export type SavedEmbed = { id: number; name: string; payload_json: string; mode: "embed" | "text"; channel_id?: string | null; message_id?: string | null };
export type ResourcesGet = {
  channels: Channel[]; voiceChannels: Channel[]; categories: Channel[]; roles: Role[];
  emojis: ServerEmoji[]; server: ServerIdentity; stats: ServerStats;
};
export type StatsGet = {
  points: { label: string; messages: number }[];
  totals: { joins: number; leaves: number; messages: number; moderation: number };
  moderation: { type: string; label: string; count: number }[];
  topChannels: { id: string; name: string; messages: number }[];
  topUsers: { id: string; name: string; messages: number }[];
  peakHour: { day: string; hour: number; messages: number } | null;
};
export type RolePanelRow = {
  id: number; channel_id: string | null; message_id: string | null; title: string | null; style: string;
  role_limit: number; role_mode: string; notify_enabled: number; notify_template: string | null;
  role_id: string | null; label: string | null; emoji: string | null; button_color: string | null;
};
export type SavedRolePanel = {
  id: number; channel_id: string; message_id: string; title: string; style: "buttons" | "select" | "reaction";
  role_limit: number; role_mode: string; notify_enabled: number; notify_template: string;
  options: { role_id: string; label: string | null; emoji: string | null; button_color: string }[];
};
export type AuditEntry = { id: number; user_name: string; section: string; summary: string; created_at: number };
export type AuditListGet = { entries: AuditEntry[]; total: number };
export type GuildListItem = { id: string; name: string; icon: string | null };
export type GuildListGet = GuildListItem[];

export const defaultTempConfig: TempChannelConfig = { categoryId: null, nameTemplate: DEFAULT_SETTINGS.name_template, userLimit: 0, canRename: true, canManageAccess: true, canClose: true };
export const defaultTempChannels: TempChannelsState = { presets: [] };
export const tempPresetFromApi = (p: TempPresetApi): TempPreset => ({ id: p.id, name: p.name, triggerChannelIds: [...p.triggerChannelIds], config: { categoryId: p.categoryId, nameTemplate: p.nameTemplate, userLimit: p.userLimit, canRename: p.canRename, canManageAccess: p.canManageAccess, canClose: p.canClose } });

export const DEFAULT_ACCENT = "#5865f2";
export const COLOR_PRESETS = ["#5865f2", "#eb459e", "#57f287", "#fee75c", "#ed4245", "#00b0f4", "#9b59b6", "#e67e22", "#313338"];

export const buttonColorOptions: Record<string, string> = { primary: "Синяя", secondary: "Серая", success: "Зелёная", danger: "Красная" };

export type EmbedPayload = {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text?: string };
  author?: { name?: string; url?: string; icon_url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  image?: { url?: string };
  thumbnail?: { url?: string };
};
export type EmbedField = { name: string; value: string; inline: boolean };

export type MusicPutBody = MusicSettings;
export type LangPutBody = { lang: "ru" | "en" };
export type LangGet = { lang: "ru" | "en" };
export type EmbedsGet = { embeds: SavedEmbed[]; sendings: EmbedSending[] };

export function buildMusicPutBody(m: MusicSettings): MusicPutBody {
  return {
    command_channel_id: m.command_channel_id || null,
    voice_channel_ids: [...m.voice_channel_ids],
    allowed_role_ids: [...m.allowed_role_ids],
    // 0 = автовыход выключен; остальное клампится в рабочий диапазон.
    leave_after_seconds: m.leave_after_seconds === 0 ? 0 : clampMusicSeconds(Math.round(m.leave_after_seconds) || 300),
  };
}
