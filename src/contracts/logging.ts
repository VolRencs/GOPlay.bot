import { logKeys } from "../lib/labels.ts";

export type LoggingDto = {
  channelId: string | null;
  categories: Record<string, boolean>;
};

export const loggingDefaults: LoggingDto = {
  channelId: null,
  categories: Object.fromEntries(logKeys.map(key => [key, true])),
};

export function fromDto(dto: Partial<LoggingDto>): LoggingDto {
  return { channelId: dto.channelId ?? null, categories: { ...loggingDefaults.categories, ...dto.categories } };
}

export function toDto(dto: LoggingDto): LoggingDto {
  return { channelId: dto.channelId, categories: { ...dto.categories } };
}
