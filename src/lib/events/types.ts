export const eventStatuses = ["scheduled", "live", "completed", "cancelled"] as const;
export type EventStatus = (typeof eventStatuses)[number];
export const eventButtonStyles = ["primary", "secondary", "success", "danger"] as const;
export type EventButtonStyle = (typeof eventButtonStyles)[number];
export const recurrenceFrequencies = ["none", "daily", "weekly", "biweekly", "custom"] as const;
export type RecurrenceFrequency = (typeof recurrenceFrequencies)[number];

// Форма embed'а совпадает с тем, что уходит в Discord API: композер панели
// показывает ровно то, что будет опубликовано.
export type EventEmbed = {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text?: string };
  thumbnail?: { url?: string };
  image?: { url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  timestamp?: boolean;
};
export type EventEmbedPayload = Omit<EventEmbed, "timestamp" | "footer" | "thumbnail" | "image"> & { footer?: { text: string }; thumbnail?: { url: string }; image?: { url: string } };
export type EventButton = { key: "join" | "leave"; label: string; emoji: string; style: EventButtonStyle; enabled: boolean; order: number };
export type EventRecurrence = { freq: RecurrenceFrequency; interval: number };

export type EventRow = {
  id: string; guild_id: string; channel_id: string; message_id: string | null;
  series_id: string | null; embed_json: string; buttons_json: string;
  scheduled_at: number; max_participants: number;
  registration_enabled: number; waitlist_enabled: number; status: EventStatus;
  event_role_id: string | null; reminders_json: string; recurrence_json: string;
  created_at: number; updated_at: number; started_at: number | null;
  completed_at: number | null; cancelled_at: number | null; stats_json: string | null;
};
export type ParticipantRow = { event_id: string; user_id: string; joined_at: number; waitlist: number };
export type EventCounts = { joined: number; waitlist: number };

export const MAX_REMINDER_MINUTES = 525_600;
export const MAX_PARTICIPANTS_LIMIT = 100_000;

export type RenderableEvent = { status: EventStatus; scheduledAt: number; maxParticipants: number; registrationEnabled: boolean; waitlistEnabled: boolean };

export type RenderedEventButton = EventButton & { disabled: boolean };

type JoinOutcome = "joined" | "waitlisted" | "already_joined";
export type JoinResult = { ok: true; action: JoinOutcome; state: "joined" | "waitlisted"; counts: EventCounts } | { ok: false; error: string };

type LeaveOutcome = "left" | "left_waitlist" | "promoted" | "not_registered";
export type LeaveResult = { ok: true; action: LeaveOutcome; promotedUserId: string | null; counts: EventCounts } | { ok: false; error: string };

export type EventInput = {
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

export type EventView = {
  id: string; guildId: string; channelId: string; messageId: string | null;
  embed: EventEmbed; buttons: EventButton[];
  scheduledAt: number; maxParticipants: number;
  registrationEnabled: boolean; waitlistEnabled: boolean; status: EventStatus;
  eventRoleId: string | null; reminders: number[]; recurrence: EventRecurrence;
  createdAt: number; updatedAt: number; startedAt: number | null;
  completedAt: number | null; cancelledAt: number | null;
  stats: Record<string, unknown> | null; counts: EventCounts;
  participants: { userId: string; joinedAt: number; waitlist: boolean }[];
};

export type EventListItem = Omit<EventView, "participants"> & {
  participants: (EventView["participants"][number] & { name: string | null })[];
};
export type EventListGet = { events: EventListItem[] };
