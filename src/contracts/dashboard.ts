// DTO панели, общие для серверных роутов и клиентских компонентов.
// Здесь нет импортов из React/Next — только формы данных.

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

export type EmbedPayload = {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text?: string };
  author?: { name?: string; url?: string; iconUrl?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  image?: { url?: string };
  thumbnail?: { url?: string };
};
export type EmbedField = { name: string; value: string; inline: boolean };
