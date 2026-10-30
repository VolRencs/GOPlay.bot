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
