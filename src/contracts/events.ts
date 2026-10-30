import type { EventButton, EventCounts, EventEmbed, EventRecurrence, EventStatus } from "../lib/events/types.ts";

export type EventInputDto = {
  id?: string;
  channelId: string;
  messageId: string | null;
  embed: EventEmbed;
  buttons: EventButton[];
  scheduledAt: number;
  maxParticipants: number;
  registrationEnabled: boolean;
  waitlistEnabled: boolean;
  status: EventStatus;
  eventRoleId: string | null;
  reminders: number[];
  recurrence: EventRecurrence;
};

export type EventViewDto = {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  embed: EventEmbed;
  buttons: EventButton[];
  scheduledAt: number;
  maxParticipants: number;
  registrationEnabled: boolean;
  waitlistEnabled: boolean;
  status: EventStatus;
  eventRoleId: string | null;
  reminders: number[];
  recurrence: EventRecurrence;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  cancelledAt: number | null;
  stats: Record<string, unknown> | null;
  counts: EventCounts;
  participants: { userId: string; joinedAt: number; waitlist: boolean }[];
};

export type EventListItemDto = Omit<EventViewDto, "participants"> & {
  participants: (EventViewDto["participants"][number] & { name: string | null })[];
};

export type EventListDto = { events: EventListItemDto[] };
