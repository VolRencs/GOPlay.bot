// DTO панели, общие для серверных роутов и клиентских компонентов.
// Здесь нет импортов из React/Next — только формы данных и чистые преобразования.

import type { ServerEmoji as GoEmoji } from "goemoji";

export type Channel = { id: string; name: string };
export type Role = { id: string; name: string };
export type ServerEmoji = GoEmoji & { value: string };
export type ServerStats = { members: number | null; online: number | null };
export type ServerIdentity = { name: string; icon: string | null };

export type ResourcesGet = {
  channels: Channel[];
  voiceChannels: Channel[];
  categories: Channel[];
  roles: Role[];
  emojis: ServerEmoji[];
  server: ServerIdentity;
  stats: ServerStats;
};

export type StatsGet = {
  points: { label: string; messages: number }[];
  totals: { joins: number; leaves: number; messages: number; moderation: number };
  moderation: { type: string; label: string; count: number }[];
  topChannels: { id: string; name: string; messages: number }[];
  topUsers: { id: string; name: string; messages: number }[];
  peakHour: { day: string; hour: number; messages: number } | null;
};

export type { EmbedField, EmbedPayload } from "./embeds.ts";

export type LangCode = "ru" | "en";
export type LangDto = { lang: LangCode };

export function toLangDto(lang: LangCode): LangDto {
  return { lang };
}

export function fromLangDto(dto: LangDto): LangCode {
  return dto.lang;
}

export type AdminGuildDto = {
  id: string;
  name: string;
  messages: number;
  panels: number;
  events: number;
};

export type AdminDataDto = {
  online: boolean;
  uptimeMs: number | null;
  guildCount: number;
  messages7d: number;
  moderation7d: number;
  members: number | null;
  guilds: AdminGuildDto[];
};

export type AuditEntryDto = {
  id: number;
  userName: string;
  section: string;
  summary: string;
  createdAt: number;
};

export type AuditListDto = { entries: AuditEntryDto[]; total: number };

export type AuditEntrySource = {
  id: number;
  user_name: string;
  section: string;
  summary: string;
  created_at: number;
  total: number;
};

export function toAuditDto(row: AuditEntrySource): AuditEntryDto {
  return { id: row.id, userName: row.user_name, section: row.section, summary: row.summary, createdAt: row.created_at };
}
