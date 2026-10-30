import type { ButtonStyleName } from "../../lib/constants.ts";

export {
  BRAND_ACCENT as DEFAULT_ACCENT,
  COLOR_PRESETS,
  colorNumberToHex,
  hexToColorNumber,
} from "../../lib/colors.ts";

// Общие DTO живут вне компонентов и используются серверными роутами.
export type {
  Channel,
  EmbedField,
  EmbedPayload,
  ResourcesGet,
  Role,
  ServerEmoji,
  StatsGet,
} from "../../contracts/dashboard.ts";
export type { EmbedDto, EmbedSendingDto, EmbedsGetDto } from "../../contracts/embeds.ts";
export type { RolePanelRowDto } from "../../contracts/roles.ts";

export type PanelNotify = (message: string, tone?: "ok" | "warn") => void;
export type PanelFail = (message: string) => void;
export type SavedRolePanel = {
  id: number;
  channelId: string;
  messageId: string;
  title: string;
  style: "buttons" | "select" | "reaction";
  roleLimit: number;
  roleMode: string;
  notifyEnabled: boolean;
  notifyTemplate: string;
  options: { roleId: string; label: string | null; emoji: string | null; buttonColor: string }[];
};

const buttonColorOptions: Record<ButtonStyleName, string> = { primary: "Синяя", secondary: "Серая", success: "Зелёная", danger: "Красная" };
export const buttonColorOptionsList: { value: ButtonStyleName; label: string }[] = (Object.keys(buttonColorOptions) as ButtonStyleName[]).map(value => ({ value, label: buttonColorOptions[value] }));
