import { parseStringArray } from "../lib/json.ts";

export type TempChannelConfigDto = {
  categoryId: string | null;
  nameTemplate: string;
  userLimit: number;
  canRename: boolean;
  canManageAccess: boolean;
  canClose: boolean;
};

export type TempPresetDto = {
  id: number;
  name: string;
  triggerChannelIds: string[];
  config: TempChannelConfigDto;
};

export type TempchannelsDto = { presets: TempPresetDto[] };
export type TempPresetInput = { name: string; triggerChannelIds: string[]; config: TempChannelConfigDto };
export type TempPutBody = { presets: TempPresetInput[] };

export type TempPresetSource = {
  id: number;
  name: string;
  trigger_channel_ids_json: string;
  category_id: string | null;
  name_template: string;
  user_limit: number;
  can_rename: number;
  can_manage_access: number;
  can_close: number;
};

export const defaultTempConfig: TempChannelConfigDto = {
  categoryId: null,
  nameTemplate: "🔊 {username}'s room",
  userLimit: 0,
  canRename: true,
  canManageAccess: true,
  canClose: true,
};

export function toDto(row: TempPresetSource): TempPresetDto {
  return {
    id: row.id,
    name: row.name,
    triggerChannelIds: parseStringArray(row.trigger_channel_ids_json),
    config: {
      categoryId: row.category_id,
      nameTemplate: row.name_template,
      userLimit: row.user_limit,
      canRename: Boolean(row.can_rename),
      canManageAccess: Boolean(row.can_manage_access),
      canClose: Boolean(row.can_close),
    },
  };
}

export function fromDto(preset: TempPresetInput): TempPresetInput {
  return {
    name: preset.name,
    triggerChannelIds: [...preset.triggerChannelIds],
    config: { ...preset.config, canRename: Boolean(preset.config.canRename), canManageAccess: Boolean(preset.config.canManageAccess), canClose: Boolean(preset.config.canClose) },
  };
}
