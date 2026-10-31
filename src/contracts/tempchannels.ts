import { parseStringArray } from "../lib/json.ts";
import { DEFAULT_SETTINGS } from "../lib/tempchannels.ts";

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
  categoryId: DEFAULT_SETTINGS.category_id,
  nameTemplate: DEFAULT_SETTINGS.name_template,
  userLimit: DEFAULT_SETTINGS.user_limit,
  canRename: Boolean(DEFAULT_SETTINGS.can_rename),
  canManageAccess: Boolean(DEFAULT_SETTINGS.can_manage_access),
  canClose: Boolean(DEFAULT_SETTINGS.can_close),
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
