import { clampMusicSeconds, type LoggingPutBody } from "../../lib/labels.ts";
import type { ButtonStyleName } from "../../lib/constants.ts";
import type { MusicSettings } from "../../lib/music-settings.ts";
import { DEFAULT_MUSIC_LEAVE_SECONDS } from "../../lib/constants.ts";

export {
  BRAND_ACCENT as DEFAULT_ACCENT,
  COLOR_PRESETS,
  colorNumberToHex,
  hexToColorNumber,
} from "../../lib/colors.ts";

// Общие DTO живут вне компонентов и используются серверными роутами.
export type {
  AuditEntry,
  AuditListGet,
  Channel,
  EmbedField,
  EmbedPayload,
  EmbedSending,
  EmbedsGet,
  ResourcesGet,
  Role,
  RolePanelRow,
  SavedEmbed,
  ServerEmoji,
  ServerIdentity,
  ServerStats,
  StatsGet,
} from "../../contracts/dashboard.ts";

export type PanelNotify = (message: string, tone?: "ok" | "warn") => void;
export type PanelFail = (message: string) => void;
export type LoggingState = Omit<LoggingPutBody, "channelId"> & { channelId: string };

export type SavedRolePanel = {
  id: number;
  channel_id: string;
  message_id: string;
  title: string;
  style: "buttons" | "select" | "reaction";
  role_limit: number;
  role_mode: string;
  notify_enabled: number;
  notify_template: string;
  options: { role_id: string; label: string | null; emoji: string | null; button_color: string }[];
};

const buttonColorOptions: Record<ButtonStyleName, string> = { primary: "Синяя", secondary: "Серая", success: "Зелёная", danger: "Красная" };
export const buttonColorOptionsList: { value: ButtonStyleName; label: string }[] = (Object.keys(buttonColorOptions) as ButtonStyleName[]).map(value => ({ value, label: buttonColorOptions[value] }));

export function buildMusicPutBody(m: MusicSettings): MusicSettings {
  return {
    command_channel_id: m.command_channel_id || null,
    voice_channel_ids: [...m.voice_channel_ids],
    allowed_role_ids: [...m.allowed_role_ids],
    // 0 = автовыход выключен; остальное клампится в рабочий диапазон.
    leave_after_seconds: m.leave_after_seconds === 0 ? 0 : clampMusicSeconds(Math.round(m.leave_after_seconds) || DEFAULT_MUSIC_LEAVE_SECONDS),
  };
}
