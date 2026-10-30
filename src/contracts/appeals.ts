export type AppealStatus = "pending" | "reviewing" | "approved" | "rejected" | "closed" | "declined";

export type AppealDto = {
  id: number;
  number: number;
  guildId: string;
  userId: string;
  punishmentId: number;
  type: string;
  reason: string;
  moderatorComment: string | null;
  status: AppealStatus;
  createdAt: number;
  updatedAt: number;
  reviewedBy: string | null;
  reviewedAt: number | null;
  punishmentReason: string | null;
  punishmentCreatedAt: number;
};

export type AppealsListDto = { appeals: AppealDto[] };

export type AppealSource = {
  id: number;
  number: number;
  guild_id: string;
  user_id: string;
  punishment_id: number;
  type: string;
  reason: string;
  moderator_comment: string | null;
  status: AppealStatus;
  created_at: number;
  updated_at: number;
  reviewed_by: string | null;
  reviewed_at: number | null;
  punishment_reason: string | null;
  punishment_created_at: number;
};

export function toDto(row: AppealSource): AppealDto {
  return {
    id: row.id,
    number: row.number,
    guildId: row.guild_id,
    userId: row.user_id,
    punishmentId: row.punishment_id,
    type: row.type,
    reason: row.reason,
    moderatorComment: row.moderator_comment,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    punishmentReason: row.punishment_reason,
    punishmentCreatedAt: row.punishment_created_at,
  };
}
