import { db } from "../../db/database.ts";

// Все statements готовятся один раз на старте: SQLite не парсит SQL внутри
// обработчиков событий.
export const stmt = {
  guildInsert: db.prepare("INSERT OR IGNORE INTO guilds(id,name,icon,updated_at) VALUES(?,?,?,?)"),
  guildName: db.prepare("SELECT name FROM guilds WHERE id=?"),
  guildIds: db.prepare("SELECT id FROM guilds"),
  rules: db.prepare("SELECT kind,action_json,threshold_json,window_seconds,escalation FROM automod_rules WHERE guild_id=? AND enabled=1 ORDER BY id"),
  security: db.prepare("SELECT ignored_role_ids_json,protected_channel_id FROM guild_security_settings WHERE guild_id=?"),
  welcomeSettings: db.prepare("SELECT * FROM welcome_settings WHERE guild_id=?"),
  loggingSettings: db.prepare("SELECT channel_id,categories_json FROM logging_settings WHERE guild_id=?"),
  metric: db.prepare("INSERT INTO guild_daily_metrics(guild_id,day,joins,leaves,messages,moderation) VALUES(?,?,?,?,?,?) ON CONFLICT(guild_id,day) DO UPDATE SET joins=joins+excluded.joins,leaves=leaves+excluded.leaves,messages=messages+excluded.messages,moderation=moderation+excluded.moderation"),
  channelMetric: db.prepare("INSERT INTO guild_daily_channel_stats(guild_id,day,channel_id,messages) VALUES(?,?,?,?) ON CONFLICT(guild_id,day,channel_id) DO UPDATE SET messages=messages+excluded.messages"),
  userMetric: db.prepare("INSERT INTO guild_daily_user_stats(guild_id,day,user_id,messages) VALUES(?,?,?,?) ON CONFLICT(guild_id,day,user_id) DO UPDATE SET messages=messages+excluded.messages"),
  hourlyMetric: db.prepare("INSERT INTO guild_hourly_messages(guild_id,day,hour,messages) VALUES(?,?,?,?) ON CONFLICT(guild_id,day,hour) DO UPDATE SET messages=messages+excluded.messages"),
  cleanupChannelStats: db.prepare("DELETE FROM guild_daily_channel_stats WHERE day<?"),
  cleanupUserStats: db.prepare("DELETE FROM guild_daily_user_stats WHERE day<?"),
  cleanupHourlyStats: db.prepare("DELETE FROM guild_hourly_messages WHERE day<?"),
  cleanupDailyStats: db.prepare("DELETE FROM guild_daily_metrics WHERE day<?"),
  tempPresets: db.prepare("SELECT * FROM temp_channel_presets WHERE guild_id=? ORDER BY id"),
  tempAll: db.prepare("SELECT * FROM temp_channels"),
  tempByOwner: db.prepare("SELECT * FROM temp_channels WHERE guild_id=? AND owner_id=?"),
  tempByChannel: db.prepare("SELECT * FROM temp_channels WHERE channel_id=?"),
  tempInsert: db.prepare("INSERT INTO temp_channels(guild_id,channel_id,owner_id,panel_message_id,source_channel_id,created_at) VALUES(?,?,?,?,?,?)"),
  tempDelete: db.prepare("DELETE FROM temp_channels WHERE channel_id=?"),
  tempUpdateOwner: db.prepare("UPDATE temp_channels SET owner_id=? WHERE channel_id=?"),
  tempUpdatePanel: db.prepare("UPDATE temp_channels SET panel_message_id=? WHERE channel_id=?"),
  panel: db.prepare("SELECT role_limit,role_mode,notify_enabled,notify_template FROM self_role_panels WHERE id=? AND guild_id=?"),
  panelOptionEmoji: db.prepare("SELECT role_id,emoji FROM self_role_options WHERE panel_id=?"),
  automodRecent: db.prepare("SELECT COUNT(*) AS count FROM moderation_actions WHERE guild_id=? AND user_id=? AND type='automod' AND created_at>?"),
  panelDelete: db.prepare("DELETE FROM self_role_panels WHERE guild_id=? AND channel_id=? AND message_id=?"),
  embedDetach: db.prepare("UPDATE embeds SET channel_id=NULL,message_id=NULL,updated_at=? WHERE guild_id=? AND channel_id=? AND message_id=?"),
  warns: db.prepare("SELECT m.reason,m.created_at FROM moderation_actions m WHERE m.guild_id=? AND m.user_id=? AND m.type='warn' AND NOT EXISTS(SELECT 1 FROM appeals a WHERE a.punishment_id=m.id AND a.status='approved') ORDER BY m.created_at DESC"),
  moderationInsert: db.prepare("INSERT INTO moderation_actions(guild_id,user_id,moderator_id,type,reason,created_at) VALUES(?,?,?,?,?,?)"),
  warnDelete: db.prepare("DELETE FROM moderation_actions WHERE guild_id=? AND type='warn' AND (? IS NULL OR user_id=?)"),
  appealDeleteForWarns: db.prepare("DELETE FROM appeals WHERE punishment_id IN (SELECT id FROM moderation_actions WHERE guild_id=? AND type='warn' AND (? IS NULL OR user_id=?))"),
  dataVersion: db.prepare("PRAGMA data_version"),
  panelReactions: db.prepare("SELECT id,role_mode,message_id FROM self_role_panels WHERE guild_id=? AND style='reaction'"),
  messageUpsert: db.prepare("INSERT INTO message_cache(message_id,guild_id,channel_id,content,created_at) VALUES(?,?,?,?,?) ON CONFLICT(message_id) DO UPDATE SET content=excluded.content"),
  messageGet: db.prepare("SELECT content FROM message_cache WHERE message_id=?"),
  messageDelete: db.prepare("DELETE FROM message_cache WHERE message_id=?"),
  messagePrune: db.prepare("DELETE FROM message_cache WHERE guild_id=? AND created_at < (SELECT created_at FROM message_cache WHERE guild_id=? ORDER BY created_at DESC LIMIT 1 OFFSET ?)"),
  musicSettings: db.prepare("SELECT * FROM music_settings WHERE guild_id=?"),
  musicSessionUpsert: db.prepare("INSERT INTO music_sessions(guild_id,channel_id,message_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id,message_id=excluded.message_id,updated_at=excluded.updated_at"),
  musicSessionDelete: db.prepare("DELETE FROM music_sessions WHERE guild_id=?"),
  musicSessionAll: db.prepare("SELECT guild_id,channel_id,message_id FROM music_sessions"),
  levelSettings: db.prepare("SELECT * FROM level_settings WHERE guild_id=?"),
  levelSettingsUpsert: db.prepare("INSERT INTO level_settings(guild_id,enabled,xp_per_message,message_cooldown_seconds,min_message_length,xp_per_voice_minute,base_xp,growth_percent,ignored_channel_ids_json,ignored_role_ids_json,notify_mode,notify_channel_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled,xp_per_message=excluded.xp_per_message,message_cooldown_seconds=excluded.message_cooldown_seconds,min_message_length=excluded.min_message_length,xp_per_voice_minute=excluded.xp_per_voice_minute,base_xp=excluded.base_xp,growth_percent=excluded.growth_percent,ignored_channel_ids_json=excluded.ignored_channel_ids_json,ignored_role_ids_json=excluded.ignored_role_ids_json,notify_mode=excluded.notify_mode,notify_channel_id=excluded.notify_channel_id,updated_at=excluded.updated_at"),
  levelRow: db.prepare("SELECT xp,level,messages,voice_seconds FROM member_levels WHERE guild_id=? AND user_id=?"),
  levelUpsert: db.prepare("INSERT INTO member_levels(guild_id,user_id,xp,level,messages,voice_seconds,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET xp=xp+excluded.xp,level=MAX(level,excluded.level),messages=messages+excluded.messages,voice_seconds=voice_seconds+excluded.voice_seconds,updated_at=excluded.updated_at"),
  levelRank: db.prepare("SELECT COUNT(*)+1 AS rank FROM member_levels WHERE guild_id=? AND xp>?"),
  levelTop: db.prepare("SELECT user_id,xp FROM member_levels WHERE guild_id=? ORDER BY xp DESC LIMIT ?"),
  levelRewardsAll: db.prepare("SELECT level,role_id FROM level_rewards WHERE guild_id=? ORDER BY level"),
  levelRewardsDelete: db.prepare("DELETE FROM level_rewards WHERE guild_id=?"),
  levelRewardsInsert: db.prepare("INSERT INTO level_rewards(guild_id,level,role_id) VALUES(?,?,?)"),
};

export function isForeignKeyError(error: unknown): boolean {
  return Error.isError(error) && /FOREIGN KEY/i.test(error.message);
}

/** Гильдии, присутствующие в таблице guilds; null — БД недоступна. */
export function aliveGuildIds(): Set<string> | null {
  try { return new Set((stmt.guildIds.all() as { id: string }[]).map(row => row.id)); }
  catch { return null; }
}
