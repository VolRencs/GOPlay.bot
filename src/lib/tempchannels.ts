import type { TempChannelConfig, TempPresetApi } from "../components/dashboard/types.ts";
import { clampNumber } from "./constants.ts";

export type TempConfig = { category_id: string | null; name_template: string; user_limit: number; can_rename: number; can_manage_access: number; can_close: number };
export const DEFAULT_SETTINGS: TempConfig = { category_id: null, name_template: "🔊 {username}'s room", user_limit: 0, can_rename: 1, can_manage_access: 1, can_close: 1 };

type TempPresetPutBody = {
  name: string;
  triggerChannelIds: string[];
  config: TempChannelConfig;
};
export type TempPutBody = { presets: TempPresetPutBody[] };
export type TempchannelsGet = { presets: TempPresetApi[] };

export function clampUserLimit(value: unknown): number {
  return clampNumber(value ?? 0, 0, 0, 99, "integer");
}

export function buildTempPutBody(
  presets: { name: string; triggerChannelIds: string[]; config: TempChannelConfig }[],
): TempPutBody {
  return { presets: presets.map(p => ({ name: p.name, triggerChannelIds: [...p.triggerChannelIds], config: { ...p.config } })) };
}