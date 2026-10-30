export type RolePanelRowDto = {
  id: number;
  channelId: string | null;
  messageId: string | null;
  title: string | null;
  style: string;
  roleLimit: number;
  roleMode: string;
  notifyEnabled: boolean;
  notifyTemplate: string | null;
  roleId: string | null;
  label: string | null;
  emoji: string | null;
  buttonColor: string | null;
};

export type RolePanelOptionInput = {
  roleId: string;
  label?: string;
  emoji?: string;
  buttonColor?: string;
};

export type RolePanelInput = {
  panelId?: number;
  embedId: number;
  channelId?: string;
  messageId?: string;
  style?: "buttons" | "select" | "reaction";
  roleLimit?: number;
  roleMode?: "toggle" | "add" | "remove";
  notifyEnabled?: boolean;
  notifyTemplate?: string;
  options?: RolePanelOptionInput[];
};

export type RolePanelRowSource = {
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

export function toDto(row: RolePanelRowSource): RolePanelRowDto {
  return {
    id: row.id,
    channelId: row.channel_id,
    messageId: row.message_id,
    title: row.title,
    style: row.style,
    roleLimit: row.role_limit,
    roleMode: row.role_mode,
    notifyEnabled: Boolean(row.notify_enabled),
    notifyTemplate: row.notify_template,
    roleId: row.role_id,
    label: row.label,
    emoji: row.emoji,
    buttonColor: row.button_color,
  };
}
