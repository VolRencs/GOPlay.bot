import { safeJson } from "../lib/json.ts";

// Shared embed model for message and event composers; Discord limits live here.
export type EmbedField = { name: string; value: string; inline?: boolean };

export type EmbedAuthor = { name?: string; url?: string; iconUrl?: string };

export type EmbedContent = { title?: string; description?: string; color?: number; footer?: { text?: string }; author?: EmbedAuthor; image?: { url?: string }; thumbnail?: { url?: string }; fields?: EmbedField[] };

export type EmbedPayload = EmbedContent;

export type DiscordEmbed = Omit<EmbedContent, "footer" | "author" | "image" | "thumbnail"> & {
  footer?: { text: string };
  author?: { name: string; url?: string; icon_url?: string };
  image?: { url: string };
  thumbnail?: { url: string };
};

// Discord limit: title + description + fields + footer + author must stay <= 6000.
export const EMBED_LIMITS = { title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, authorName: 256, url: 2048, total: 6000 } as const;

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function mediaUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  return typeof entry.url === "string" ? entry.url.trim() || undefined : undefined;
}

function footerText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  return typeof entry.text === "string" ? entry.text.trim() || undefined : undefined;
}

function cleanEmbedFields(value: unknown): { fields: EmbedField[]; halfFilled: boolean } {
  const raw = Array.isArray(value) ? value : [];
  const fields: EmbedField[] = [];
  let halfFilled = false;
  for (const entry of raw) {
    const field = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const name = (typeof field.name === "string" ? field.name : "").trim().slice(0, EMBED_LIMITS.fieldName);
    const textValue = (typeof field.value === "string" ? field.value : "").trim().slice(0, EMBED_LIMITS.fieldValue);
    if (Boolean(name) !== Boolean(textValue)) halfFilled = true;
    if (name && textValue && fields.length < EMBED_LIMITS.fields) fields.push({ name, value: textValue, inline: Boolean(field.inline) });
  }
  return { fields, halfFilled };
}

export function normalizeEmbedContent(value: unknown): { content: EmbedContent; halfFilled: boolean } {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const { fields, halfFilled } = cleanEmbedFields(v.fields);
  const title = text(v.title)?.slice(0, EMBED_LIMITS.title);
  const description = text(v.description)?.slice(0, EMBED_LIMITS.description);
  const footer = footerText(v.footer)?.slice(0, EMBED_LIMITS.footer);
  const author = (v.author && typeof v.author === "object" ? v.author : {}) as Record<string, unknown>;
  const authorName = text(author.name)?.slice(0, EMBED_LIMITS.authorName);
  const authorUrl = text(author.url)?.slice(0, EMBED_LIMITS.url);
  const authorIcon = text(author.iconUrl)?.slice(0, EMBED_LIMITS.url);
  const thumbnail = mediaUrl(v.thumbnail)?.slice(0, EMBED_LIMITS.url);
  const image = mediaUrl(v.image)?.slice(0, EMBED_LIMITS.url);
  return {
    content: {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(Number.isInteger(v.color) ? { color: v.color as number } : {}),
      ...(footer ? { footer: { text: footer } } : {}),
      ...(authorName ? { author: { name: authorName, ...(authorUrl ? { url: authorUrl } : {}), ...(authorIcon ? { iconUrl: authorIcon } : {}) } } : {}),
      ...(thumbnail ? { thumbnail: { url: thumbnail } } : {}),
      ...(image ? { image: { url: image } } : {}),
      ...(fields.length ? { fields } : {}),
    },
    halfFilled,
  };
}

export function embedCharacterCount(content: EmbedContent): number {
  return (content.title?.length ?? 0)
    + (content.description?.length ?? 0)
    + (content.footer?.text?.length ?? 0)
    + (content.author?.name?.length ?? 0)
    + (content.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);
}

// Keeps the last `preserve` fields (generated event fields) and drops user fields first.
export function fitEmbed(content: EmbedContent, preserve = 0, limit = EMBED_LIMITS.total): EmbedContent {
  const fields = [...(content.fields ?? [])];
  while (fields.length > preserve && embedCharacterCount({ ...content, fields }) > limit) {
    fields.splice(fields.length - preserve - 1, 1);
  }
  const next = { ...content };
  if (fields.length) next.fields = fields;
  else delete next.fields;
  const over = () => embedCharacterCount(next) - limit;
  if (next.description && over() > 0) next.description = next.description.slice(0, Math.max(0, next.description.length - over()));
  if (next.footer?.text && over() > 0) next.footer = { text: next.footer.text.slice(0, Math.max(0, next.footer.text.length - over())) };
  if (next.author?.name && over() > 0) next.author = { ...next.author, name: next.author.name.slice(0, Math.max(0, next.author.name.length - over())) };
  if (!next.description) delete next.description;
  if (!next.footer?.text) delete next.footer;
  if (!next.author?.name) delete next.author;
  return next;
}

export function toDiscordEmbed(content: EmbedContent): DiscordEmbed {
  const { footer, author, image, thumbnail, fields, ...rest } = content;
  return {
    ...rest,
    ...(fields?.length ? { fields: fields.map(field => ({ ...field, inline: Boolean(field.inline) })) } : {}),
    ...(footer?.text ? { footer: { text: footer.text } } : {}),
    ...(author?.name ? { author: { name: author.name, ...(author.url ? { url: author.url } : {}), ...(author.iconUrl ? { icon_url: author.iconUrl } : {}) } } : {}),
    ...(image?.url ? { image: { url: image.url } } : {}),
    ...(thumbnail?.url ? { thumbnail: { url: thumbnail.url } } : {}),
  };
}

export function parseEmbedJson(raw: string | null | undefined): EmbedContent {
  return normalizeEmbedContent(safeJson<unknown>(raw, {})).content;
}

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
  return {
    id: row.id,
    name: row.name,
    payload: parseEmbedJson(row.payload_json),
    mode: row.mode,
    updatedAt: row.updated_at,
    channelId: row.channel_id,
    messageId: row.message_id,
  };
}

export function sendingToDto(row: EmbedSendingSource): EmbedSendingDto {
  return { id: row.id, embedId: row.embed_id, channelId: row.channel_id, messageId: row.message_id, sentAt: row.sent_at };
}
