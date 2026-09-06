import { DEFAULT_SETTINGS } from "../../../src/lib/tempchannels.ts";
export type Channel = { id: string; name: string };
export type Role = { id: string; name: string };
export type ServerEmoji = { id: string; name: string; animated: boolean; value: string };
export type ServerStats = { members: number | null; online: number | null; channels: number; roles: number };
export type ServerIdentity = { name: string; icon: string | null };
export type Rule = { kind: string; enabled: number; action_json: string; threshold_json: string; window_seconds: number; escalation: number };
export type Welcome = { enabled: number; channel_id: string | null; message: string; image_enabled: number; background_path?: string | null; image_config_json: string; goodbye_enabled: number; goodbye_channel_id: string | null; goodbye_message: string };
export type LoggingState = { channelId: string; categories: Record<string, boolean> };
export type TempChannelConfig = { categoryId: string | null; nameTemplate: string; userLimit: number; canRename: boolean; canManageAccess: boolean; canClose: boolean };
export type TempPreset = { id: number; name: string; triggerChannelIds: string[]; config: TempChannelConfig };
export type TempChannelsState = { presets: TempPreset[] };
export type TempPresetApi = { id: number; name: string; triggerChannelIds: string[]; categoryId?: string | null; nameTemplate?: string; userLimit?: number; canRename?: number | boolean; canManageAccess?: number | boolean; canClose?: number | boolean };
export type EmbedSending = { id: number; embed_id: number; channel_id: string; message_id: string; sent_at: number };
export type SavedEmbed = { id: number; name: string; payload_json: string; mode: "embed" | "text"; channel_id?: string | null; message_id?: string | null };

export const defaultTempConfig: TempChannelConfig = { categoryId: null, nameTemplate: DEFAULT_SETTINGS.name_template, userLimit: 0, canRename: true, canManageAccess: true, canClose: true };
export const defaultTempChannels: TempChannelsState = { presets: [] };
export const tempPresetFromApi = (p: TempPresetApi): TempPreset => ({ id: p.id, name: p.name, triggerChannelIds: p.triggerChannelIds.map(String), config: { categoryId: p.categoryId ?? null, nameTemplate: p.nameTemplate ?? defaultTempConfig.nameTemplate, userLimit: Number(p.userLimit ?? 0), canRename: Boolean(p.canRename), canManageAccess: Boolean(p.canManageAccess), canClose: Boolean(p.canClose) } });

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

export type MusicSettingsState = {
  command_channel_id: string | null;
  voice_channel_ids: string[];
  allowed_role_ids: string[];
  leave_after_seconds: number;
};
