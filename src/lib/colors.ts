export const BRAND_COLOR = 0x8b3dff;
export const BRAND_ACCENT = "#8b3dff";

export const COLOR_PRESETS = [
  BRAND_ACCENT,
  "#eb459e",
  "#57f287",
  "#fee75c",
  "#ed4245",
  "#00b0f4",
  "#9b59b6",
  "#e67e22",
  "#313338",
] as const;

export const colorNumberToHex = (value: number | null | undefined): string =>
  `#${(value ?? BRAND_COLOR).toString(16).padStart(6, "0")}`;

export const hexToColorNumber = (value: string): number => Number.parseInt(value.slice(1), 16);
