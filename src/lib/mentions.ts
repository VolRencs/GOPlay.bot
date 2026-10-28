/** Единые Discord-упоминания для аудита, уведомлений и логов. */
export const channelRef = (id: string): string => `<#${id}>`;
export const roleRef = (id: string): string => `<@&${id}>`;
export const userRef = (id: string): string => `<@${id}>`;
