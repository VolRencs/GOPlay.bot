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

export function toDto(row: AuditEntrySource): AuditEntryDto {
  return { id: row.id, userName: row.user_name, section: row.section, summary: row.summary, createdAt: row.created_at };
}
