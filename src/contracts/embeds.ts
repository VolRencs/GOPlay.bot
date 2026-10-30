import { safeJson } from "../lib/json.ts";
import type { EmbedPayload } from "./dashboard.ts";

export type EmbedDto = {
  id: number;
  name: string;
  payload: EmbedPayload;
  mode: "embed" | "text";
  updatedAt: number;
  channelId: string | null;
  messageId: string | null;
};

export type EmbedSendingDto = {
  id: number;
  embedId: number;
  channelId: string;
  messageId: string;
  sentAt: number;
};

export type EmbedsGetDto = { embeds: EmbedDto[]; sendings: EmbedSendingDto[] };

export type EmbedSource = {
  id: number;
  name: string;
  payload_json: string;
  mode: "embed" | "text";
  updated_at: number;
  channel_id: string | null;
  message_id: string | null;
};

export type EmbedSendingSource = {
  id: number;
  embed_id: number;
  channel_id: string;
  message_id: string;
  sent_at: number;
};

export function toDto(row: EmbedSource): EmbedDto {
  const parsed = safeJson<unknown>(row.payload_json, {});
  const payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as EmbedPayload : {};
  return {
    id: row.id,
    name: row.name,
    payload,
    mode: row.mode,
    updatedAt: row.updated_at,
    channelId: row.channel_id,
    messageId: row.message_id,
  };
}

export function sendingToDto(row: EmbedSendingSource): EmbedSendingDto {
  return { id: row.id, embedId: row.embed_id, channelId: row.channel_id, messageId: row.message_id, sentAt: row.sent_at };
}
