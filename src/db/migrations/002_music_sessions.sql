-- Персистентность музыкальной панели: строка живёт, пока жива панель плеера.
-- После перезапуска процесса (штатного или краша) бот по ней находит сообщение
-- панели с мёртвыми кнопками и голосовой канал, где он застрял, — и вычищает
-- оба (см. ClientReady-очиститель в src/bot/music/index.ts). FK каскадом
-- удаляет строку при полном стирании сервера.
CREATE TABLE IF NOT EXISTS music_sessions (
  guild_id   TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
