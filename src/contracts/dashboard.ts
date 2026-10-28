// DTO панели, общие для серверных роутов и клиентских компонентов.
// Здесь нет импортов из React/Next — только формы данных.

export type Channel = { id: string; name: string };
export type Role = { id: string; name: string };
export type ServerEmoji = { id: string; name: string; animated: boolean; value: string };
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

export type EmbedSending = { id: number; embed_id: number; channel_id: string; message_id: string; sent_at: number };
// Форма строки `SELECT * FROM embeds`: все колонки присутствуют, id-шники nullable.
export type SavedEmbed = {
  id: number;
  guild_id: string;
  name: string;
  payload_json: string;
  updated_at: number;
  channel_id: string | null;
  message_id: string | null;
  mode: "embed" | "text";
};
export type EmbedPayload = {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text?: string };
  author?: { name?: string; url?: string; icon_url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  image?: { url?: string };
  thumbnail?: { url?: string };
};
export type EmbedField = { name: string; value: string; inline: boolean };
export type EmbedsGet = { embeds: SavedEmbed[]; sendings: EmbedSending[] };

export type RolePanelRow = {
  id: number;
  channel_id: string | null;
  message_id: string | null;
  title: string | null;
  style: string;
  role_limit: number;
  role_mode: string;
  notify_enabled: number;
  notify_template: string | null;
  role_id: string | null;
  label: string | null;
  emoji: string | null;
  button_color: string | null;
};

export type AuditEntry = { id: number; user_name: string; section: string; summary: string; created_at: number };
export type AuditListGet = { entries: AuditEntry[]; total: number };
