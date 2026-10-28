import { db } from "./database.ts";

// Prepared statements для API-роутов: SQL живёт в db-слое, а не в обработчиках.
export const welcomeQueries = {
  upsert: db.prepare(`INSERT INTO welcome_settings(guild_id,enabled,channel_id,message,image_enabled,image_config_json,goodbye_enabled,goodbye_channel_id,goodbye_message,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled,channel_id=excluded.channel_id,message=excluded.message,image_enabled=excluded.image_enabled,image_config_json=excluded.image_config_json,goodbye_enabled=excluded.goodbye_enabled,goodbye_channel_id=excluded.goodbye_channel_id,goodbye_message=excluded.goodbye_message,updated_at=excluded.updated_at`),
  backgroundUpsert: db.prepare("INSERT INTO welcome_settings(guild_id,background_path,updated_at) VALUES(?,?,?) ON CONFLICT(guild_id) DO UPDATE SET background_path=excluded.background_path,updated_at=excluded.updated_at"),
};

export const automodQueries = {
  securityUpsert: db.prepare("INSERT INTO guild_security_settings(guild_id,ignored_role_ids_json,protected_channel_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET ignored_role_ids_json=excluded.ignored_role_ids_json,protected_channel_id=excluded.protected_channel_id,updated_at=excluded.updated_at"),
  rulesAll: db.prepare("SELECT * FROM automod_rules WHERE guild_id=?"),
  ruleGet: db.prepare("SELECT enabled,action_json,threshold_json,window_seconds,escalation FROM automod_rules WHERE guild_id=? AND kind=?"),
  ruleUpsert: db.prepare("INSERT INTO automod_rules(guild_id,kind,enabled,action_json,threshold_json,window_seconds,escalation,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(guild_id,kind) DO UPDATE SET enabled=excluded.enabled,action_json=excluded.action_json,threshold_json=excluded.threshold_json,window_seconds=excluded.window_seconds,escalation=excluded.escalation,updated_at=excluded.updated_at"),
};

export const rolesQueries = {
  list: db.prepare("SELECT p.*,o.role_id,o.label,o.emoji,o.button_color FROM self_role_panels p LEFT JOIN self_role_options o ON o.panel_id=p.id WHERE p.guild_id=? ORDER BY p.updated_at DESC"),
  embedTemplate: db.prepare("SELECT name FROM embeds WHERE id=? AND guild_id=?"),
  panelGet: db.prepare("SELECT title,style,role_limit,role_mode,notify_enabled,notify_template FROM self_role_panels WHERE id=? AND guild_id=?"),
  panelOptions: db.prepare("SELECT role_id FROM self_role_options WHERE panel_id=?"),
  insert: db.prepare("INSERT INTO self_role_panels(guild_id,channel_id,message_id,title,style,role_limit,role_mode,notify_enabled,notify_template,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)"),
  update: db.prepare("UPDATE self_role_panels SET channel_id=?,message_id=?,title=?,style=?,role_limit=?,role_mode=?,notify_enabled=?,notify_template=?,updated_at=? WHERE id=? AND guild_id=?"),
  rollbackDelete: db.prepare("DELETE FROM self_role_panels WHERE id=?"),
  delete: db.prepare("DELETE FROM self_role_panels WHERE id=? AND guild_id=?"),
  optionsDelete: db.prepare("DELETE FROM self_role_options WHERE panel_id=?"),
  optionInsert: db.prepare("INSERT INTO self_role_options(panel_id,role_id,label,emoji,button_color) VALUES(?,?,?,?,?)"),
  forDelete: db.prepare("SELECT p.channel_id,p.message_id,p.style,p.title FROM self_role_panels p WHERE p.id=? AND p.guild_id=?"),
  emojis: db.prepare("SELECT emoji FROM self_role_options WHERE panel_id=?"),
};

export const embedsQueries = {
  list: db.prepare("SELECT * FROM embeds WHERE guild_id=? ORDER BY updated_at DESC"),
  sendings: db.prepare("SELECT s.id,s.embed_id,s.channel_id,s.message_id,s.sent_at FROM embed_sendings s WHERE s.guild_id=? ORDER BY s.sent_at DESC LIMIT 50"),
  payloads: db.prepare("SELECT payload_json FROM embeds WHERE guild_id=?"),
  saveUpdate: db.prepare("UPDATE embeds SET name=?,payload_json=?,mode=?,channel_id=COALESCE(NULLIF(?,''),channel_id),updated_at=? WHERE id=? AND guild_id=?"),
  saveInsert: db.prepare("INSERT INTO embeds(guild_id,name,payload_json,channel_id,mode,updated_at) VALUES(?,?,?,?,?,?)"),
  byId: db.prepare("SELECT channel_id,message_id,payload_json,name,mode FROM embeds WHERE id=? AND guild_id=?"),
  publishUpdate: db.prepare("UPDATE embeds SET name=?,payload_json=?,channel_id=?,message_id=?,mode=?,updated_at=? WHERE id=? AND guild_id=?"),
  publishInsert: db.prepare("INSERT INTO embeds(guild_id,name,payload_json,channel_id,message_id,mode,updated_at) VALUES(?,?,?,?,?,?,?)"),
  sendingInsert: db.prepare("INSERT INTO embed_sendings(guild_id,embed_id,channel_id,message_id,sent_at) VALUES(?,?,?,?,?)"),
  sendingById: db.prepare("SELECT channel_id,message_id FROM embed_sendings WHERE id=? AND guild_id=?"),
  sendingDelete: db.prepare("DELETE FROM embed_sendings WHERE id=? AND guild_id=?"),
  sendingsByEmbedDelete: db.prepare("DELETE FROM embed_sendings WHERE embed_id=? AND guild_id=?"),
  delete: db.prepare("DELETE FROM embeds WHERE id=? AND guild_id=?"),
};

/** Удаление отмеченных stale-отправок: набор ID динамический, поэтому prepare один раз. */
export function deleteEmbedSendings(ids: readonly number[]) {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`DELETE FROM embed_sendings WHERE id IN (${placeholders})`).run(...ids);
}

export const statsQueries = {
  daily: db.prepare("SELECT day,joins,leaves,messages,moderation FROM guild_daily_metrics WHERE guild_id=? AND day>=? ORDER BY day"),
  hourly: db.prepare("SELECT day,hour,messages FROM guild_hourly_messages WHERE guild_id=? AND day>=? ORDER BY day,hour"),
  moderation: db.prepare("SELECT type,COUNT(*) AS count FROM moderation_actions WHERE guild_id=? AND created_at>? GROUP BY type ORDER BY count DESC"),
  topChannels: db.prepare("SELECT channel_id AS id,SUM(messages) AS messages FROM guild_daily_channel_stats WHERE guild_id=? AND day>=? GROUP BY channel_id ORDER BY messages DESC LIMIT 5"),
  topUsers: db.prepare("SELECT user_id AS id,SUM(messages) AS messages FROM guild_daily_user_stats WHERE guild_id=? AND day>=? GROUP BY user_id ORDER BY messages DESC LIMIT 5"),
  peakHour: db.prepare("SELECT day,hour,messages FROM guild_hourly_messages WHERE guild_id=? AND day>=? ORDER BY messages DESC LIMIT 1"),
};

const auditBase = "SELECT id,user_name,section,summary,created_at,COUNT(*) OVER() AS total FROM dashboard_audit WHERE guild_id=?";
export const auditQueries = {
  list: db.prepare(`${auditBase} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`),
  bySection: db.prepare(`${auditBase} AND section=? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`),
};

export const adminQueries = {
  guildCount: db.prepare("SELECT COUNT(*) AS c FROM guilds"),
  activity7d: db.prepare("SELECT COALESCE(SUM(messages),0) AS m, COALESCE(SUM(moderation),0) AS mod FROM guild_daily_metrics WHERE day>=?"),
  guilds: db.prepare("SELECT id,name,icon FROM guilds ORDER BY name"),
  messages: db.prepare("SELECT guild_id,SUM(messages) AS m FROM guild_daily_metrics GROUP BY guild_id"),
  panels: db.prepare("SELECT guild_id,COUNT(*) AS c FROM self_role_panels GROUP BY guild_id"),
  events: db.prepare("SELECT guild_id,COUNT(*) AS c FROM events GROUP BY guild_id"),
};

export const loggingQueries = {
  upsert: db.prepare("INSERT INTO logging_settings(guild_id,channel_id,categories_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id,categories_json=excluded.categories_json,updated_at=excluded.updated_at"),
};

export const langQueries = {
  update: db.prepare("UPDATE guilds SET lang=?, updated_at=? WHERE id=? AND lang<>?"),
};

export const musicQueries = {
  upsert: db.prepare("INSERT INTO music_settings(guild_id,command_channel_id,voice_channel_ids_json,allowed_role_ids_json,leave_after_seconds) VALUES(?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET command_channel_id=excluded.command_channel_id,voice_channel_ids_json=excluded.voice_channel_ids_json,allowed_role_ids_json=excluded.allowed_role_ids_json,leave_after_seconds=excluded.leave_after_seconds"),
};

export const tempchannelQueries = {
  delete: db.prepare("DELETE FROM temp_channel_presets WHERE guild_id=?"),
  insert: db.prepare("INSERT INTO temp_channel_presets(guild_id,name,trigger_channel_ids_json,category_id,name_template,user_limit,can_rename,can_manage_access,can_close,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)"),
};

export const eventQueries = {
  embeds: db.prepare("SELECT embed_json FROM events WHERE guild_id=?"),
};
