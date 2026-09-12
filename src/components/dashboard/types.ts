import { clampMusicSeconds, type LoggingPutBody } from "../../lib/labels.ts";
import type { ButtonStyleName } from "../../lib/constants.ts";
import type { MusicSettings } from "../../lib/music-settings.ts";
export type Channel = { id: string; name: string };
export type Role = { id: string; name: string };
// Единые сигнатуры уведомлений панелей: успех с тоном и ошибка.
export type PanelNotify = (message: string, tone?: "ok" | "warn") => void;
export type PanelFail = (message: string) => void;
export type ServerEmoji = { id: string; name: string; animated: boolean; value: string };
export type ServerStats = { members: number | null; online: number | null };
export type ServerIdentity = { name: string; icon: string | null };
export type LoggingState = Omit<LoggingPutBody, "channelId"> & { channelId: string };
export type EmbedSending = { id: number; embed_id: number; channel_id: string; message_id: string; sent_at: number };
// Форма строки `SELECT * FROM embeds`: все колонки присутствуют, id-шники nullable.
export type SavedEmbed = { id: number; guild_id: string; name: string; payload_json: string; updated_at: number; channel_id: string | null; message_id: string | null; mode: "embed" | "text" };
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

export const DEFAULT_ACCENT = "#5865f2";
const DEFAULT_EMBED_COLOR = 0x5865f2;
export const COLOR_PRESETS = ["#5865f2", "#eb459e", "#57f287", "#fee75c", "#ed4245", "#00b0f4", "#9b59b6", "#e67e22", "#313338"];

/** Один конвертер чисел Discord-цвета и hex — источник истины для обоих композеров. */
export const colorNumberToHex = (value: number | null | undefined): string => `#${(value ?? DEFAULT_EMBED_COLOR).toString(16).padStart(6, "0")}`;
export const hexToColorNumber = (value: string): number => Number.parseInt(value.slice(1), 16);

const buttonColorOptions: Record<ButtonStyleName, string> = { primary: "Синяя", secondary: "Серая", success: "Зелёная", danger: "Красная" };
export const buttonColorOptionsList: { value: ButtonStyleName; label: string }[] = (Object.keys(buttonColorOptions) as ButtonStyleName[]).map(value => ({ value, label: buttonColorOptions[value] }));

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

export type EmbedsGet = { embeds: SavedEmbed[]; sendings: EmbedSending[] };

export function buildMusicPutBody(m: MusicSettings): MusicSettings {
  return {
    command_channel_id: m.command_channel_id || null,
    voice_channel_ids: [...m.voice_channel_ids],
    allowed_role_ids: [...m.allowed_role_ids],
    // 0 = автовыход выключен; остальное клампится в рабочий диапазон.
    leave_after_seconds: m.leave_after_seconds === 0 ? 0 : clampMusicSeconds(Math.round(m.leave_after_seconds) || 300),
  };
}
