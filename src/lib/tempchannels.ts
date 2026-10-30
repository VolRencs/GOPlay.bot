import { clampNumber } from "./constants.ts";

export type TempConfig = { category_id: string | null; name_template: string; user_limit: number; can_rename: number; can_manage_access: number; can_close: number };
export const DEFAULT_SETTINGS: TempConfig = { category_id: null, name_template: "🔊 {username}'s room", user_limit: 0, can_rename: 1, can_manage_access: 1, can_close: 1 };

export type TempPresetRow = { id: number; guild_id: string; name: string; trigger_channel_ids_json: string; category_id: string | null; name_template: string; user_limit: number; can_rename: number; can_manage_access: number; can_close: number; updated_at: number };

export function clampUserLimit(value: unknown): number {
  return clampNumber(value, 0, 0, 99, "integer");
}