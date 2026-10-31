import { read, upsert, write } from "./typed.ts";
import type { AuditEntrySource } from "../contracts/audit.ts";
import type { EmbedSendingSource, EmbedSource } from "../contracts/embeds.ts";
import type { RolePanelRowSource } from "../contracts/roles.ts";
import type {
  AutomodRuleSettingsRow, GuildSecuritySettingsRow, LoggingSettingsRow,
  MusicSettingsRow, WelcomeSettingsRow,
} from "./rows.ts";

// Prepared statements для API-роутов: SQL живёт в db-слое, а не в обработчиках.
export const welcomeQueries = {
  upsert: upsert<Omit<WelcomeSettingsRow, "background_path">>(
    "welcome_settings",
    ["guild_id", "enabled", "channel_id", "message", "image_enabled", "image_config_json", "goodbye_enabled", "goodbye_channel_id", "goodbye_message", "updated_at"],
    ["guild_id"],
  ),
  backgroundUpsert: upsert<WelcomeSettingsRow>(
    "welcome_settings",
    ["guild_id", "enabled", "channel_id", "message", "image_enabled", "image_config_json", "goodbye_enabled", "goodbye_channel_id", "goodbye_message", "background_path", "updated_at"],
    ["guild_id"],
    ["background_path=excluded.background_path", "updated_at=excluded.updated_at"],
  ),
};

export const automodQueries = {
  securityUpsert: upsert<GuildSecuritySettingsRow>(
    "guild_security_settings",
    ["guild_id", "ignored_role_ids_json", "protected_channel_id", "updated_at"],
    ["guild_id"],
  ),
  rulesAll: read<AutomodRuleSettingsRow>("SELECT * FROM automod_rules WHERE guild_id=?"),
  ruleGet: read<{ enabled: number; action_json: string; threshold_json: string; window_seconds: number; escalation: number }>("SELECT enabled,action_json,threshold_json,window_seconds,escalation FROM automod_rules WHERE guild_id=? AND kind=?"),
  ruleUpsert: upsert<Omit<AutomodRuleSettingsRow, "id">>(
    "automod_rules",
    ["guild_id", "kind", "enabled", "action_json", "threshold_json", "window_seconds", "escalation", "updated_at"],
    ["guild_id", "kind"],
  ),
};

export const rolesQueries = {
  list: read<RolePanelRowSource>("SELECT p.*,o.role_id,o.label,o.emoji,o.button_color FROM self_role_panels p LEFT JOIN self_role_options o ON o.panel_id=p.id WHERE p.guild_id=? ORDER BY p.updated_at DESC"),
  embedTemplate: read<{ name: string }>("SELECT name FROM embeds WHERE id=? AND guild_id=?"),
  panelGet: read<{ title: string; style: string; role_limit: number; role_mode: string; notify_enabled: number; notify_template: string }>("SELECT title,style,role_limit,role_mode,notify_enabled,notify_template FROM self_role_panels WHERE id=? AND guild_id=?"),
  panelOptions: read<{ role_id: string }>("SELECT role_id FROM self_role_options WHERE panel_id=?"),
  insert: write("INSERT INTO self_role_panels(guild_id,channel_id,message_id,title,style,role_limit,role_mode,notify_enabled,notify_template,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)"),
  update: write("UPDATE self_role_panels SET channel_id=?,message_id=?,title=?,style=?,role_limit=?,role_mode=?,notify_enabled=?,notify_template=?,updated_at=? WHERE id=? AND guild_id=?"),
  rollbackDelete: write("DELETE FROM self_role_panels WHERE id=?"),
  delete: write("DELETE FROM self_role_panels WHERE id=? AND guild_id=?"),
  optionsDelete: write("DELETE FROM self_role_options WHERE panel_id=?"),
  optionInsert: write("INSERT INTO self_role_options(panel_id,role_id,label,emoji,button_color) VALUES(?,?,?,?,?)"),
  forDelete: read<{ channel_id: string; message_id: string; style: string; title: string }>("SELECT p.channel_id,p.message_id,p.style,p.title FROM self_role_panels p WHERE p.id=? AND p.guild_id=?"),
  emojis: read<{ emoji: string | null }>("SELECT emoji FROM self_role_options WHERE panel_id=?"),
};

export const embedsQueries = {
  list: read<EmbedSource>("SELECT * FROM embeds WHERE guild_id=? ORDER BY updated_at DESC"),
  sendings: read<EmbedSendingSource>("SELECT s.id,s.embed_id,s.channel_id,s.message_id,s.sent_at FROM embed_sendings s WHERE s.guild_id=? ORDER BY s.sent_at DESC LIMIT 50"),
  payloads: read<{ payload_json: string }>("SELECT payload_json FROM embeds WHERE guild_id=?"),
  saveUpdate: write("UPDATE embeds SET name=?,payload_json=?,mode=?,channel_id=COALESCE(NULLIF(?,''),channel_id),updated_at=? WHERE id=? AND guild_id=?"),
  saveInsert: write("INSERT INTO embeds(guild_id,name,payload_json,channel_id,mode,updated_at) VALUES(?,?,?,?,?,?)"),
  byId: read<{ channel_id: string | null; message_id: string | null; payload_json: string; name: string; mode: "embed" | "text" }>("SELECT channel_id,message_id,payload_json,name,mode FROM embeds WHERE id=? AND guild_id=?"),
  publishUpdate: write("UPDATE embeds SET name=?,payload_json=?,channel_id=?,message_id=?,mode=?,updated_at=? WHERE id=? AND guild_id=?"),
  publishInsert: write("INSERT INTO embeds(guild_id,name,payload_json,channel_id,message_id,mode,updated_at) VALUES(?,?,?,?,?,?,?)"),
  sendingInsert: write("INSERT INTO embed_sendings(guild_id,embed_id,channel_id,message_id,sent_at) VALUES(?,?,?,?,?)"),
  sendingById: read<{ channel_id: string; message_id: string }>("SELECT channel_id,message_id FROM embed_sendings WHERE id=? AND guild_id=?"),
  sendingDelete: write("DELETE FROM embed_sendings WHERE id=? AND guild_id=?"),
  sendingsByEmbedDelete: write("DELETE FROM embed_sendings WHERE embed_id=? AND guild_id=?"),
  delete: write("DELETE FROM embeds WHERE id=? AND guild_id=?"),
};

/** Удаление отмеченных stale-отправок: набор ID динамический, поэтому prepare один раз. */
export function deleteEmbedSendings(ids: readonly number[]) {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  write(`DELETE FROM embed_sendings WHERE id IN (${placeholders})`).run(...ids);
}

export const statsQueries = {
  daily: read<{ day: string; joins: number; leaves: number; messages: number; moderation: number }>("SELECT day,joins,leaves,messages,moderation FROM guild_daily_metrics WHERE guild_id=? AND day>=? ORDER BY day"),
  hourly: read<{ day: string; hour: number; messages: number }>("SELECT day,hour,messages FROM guild_hourly_messages WHERE guild_id=? AND day>=? ORDER BY day,hour"),
  moderation: read<{ type: string; count: number }>("SELECT type,COUNT(*) AS count FROM moderation_actions WHERE guild_id=? AND created_at>? GROUP BY type ORDER BY count DESC"),
  topChannels: read<{ id: string; messages: number }>("SELECT channel_id AS id,SUM(messages) AS messages FROM guild_daily_channel_stats WHERE guild_id=? AND day>=? GROUP BY channel_id ORDER BY messages DESC LIMIT 5"),
  topUsers: read<{ id: string; messages: number }>("SELECT user_id AS id,SUM(messages) AS messages FROM guild_daily_user_stats WHERE guild_id=? AND day>=? GROUP BY user_id ORDER BY messages DESC LIMIT 5"),
  peakHour: read<{ day: string; hour: number; messages: number }>("SELECT day,hour,messages FROM guild_hourly_messages WHERE guild_id=? AND day>=? ORDER BY messages DESC LIMIT 1"),
};

const auditBase = "SELECT id,user_name,section,summary,created_at,COUNT(*) OVER() AS total FROM dashboard_audit WHERE guild_id=?";
export const auditQueries = {
  list: read<AuditEntrySource>(`${auditBase} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`),
  bySection: read<AuditEntrySource>(`${auditBase} AND section=? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`),
};

export const adminQueries = {
  guildCount: read<{ c: number }>("SELECT COUNT(*) AS c FROM guilds"),
  activity7d: read<{ m: number; mod: number }>("SELECT COALESCE(SUM(messages),0) AS m, COALESCE(SUM(moderation),0) AS mod FROM guild_daily_metrics WHERE day>=?"),
  guilds: read<{ id: string; name: string; icon: string | null }>("SELECT id,name,icon FROM guilds ORDER BY name"),
  messages: read<{ guild_id: string; m: number }>("SELECT guild_id,SUM(messages) AS m FROM guild_daily_metrics GROUP BY guild_id"),
  panels: read<{ guild_id: string; c: number }>("SELECT guild_id,COUNT(*) AS c FROM self_role_panels GROUP BY guild_id"),
  events: read<{ guild_id: string; c: number }>("SELECT guild_id,COUNT(*) AS c FROM events GROUP BY guild_id"),
};

export const loggingQueries = {
  upsert: upsert<LoggingSettingsRow>(
    "logging_settings",
    ["guild_id", "channel_id", "categories_json", "updated_at"],
    ["guild_id"],
  ),
};

export const langQueries = {
  get: read<{ lang: string }>("SELECT lang FROM guilds WHERE id=?"),
  update: write("UPDATE guilds SET lang=?, updated_at=? WHERE id=? AND lang<>?"),
};

export const musicQueries = {
  upsert: upsert<MusicSettingsRow>(
    "music_settings",
    ["guild_id", "command_channel_id", "voice_channel_ids_json", "allowed_role_ids_json", "leave_after_seconds", "playlists_enabled", "playlist_role_ids_json"],
    ["guild_id"],
  ),
};

export const tempchannelQueries = {
  delete: write("DELETE FROM temp_channel_presets WHERE guild_id=?"),
  insert: write("INSERT INTO temp_channel_presets(guild_id,name,trigger_channel_ids_json,category_id,name_template,user_limit,can_rename,can_manage_access,can_close,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)"),
};

export const eventQueries = {
  embeds: read<{ embed_json: string }>("SELECT embed_json FROM events WHERE guild_id=?"),
};
