// Общий setup тестов: временная БД, заготовки гильдий, стабы Discord.
// Файл не матчится `*.test.ts`, поэтому node --test его не запускает.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Изолированная БД: DATABASE_PATH должен быть выставлен ДО импорта database.ts. */
export function useTempDb(prefix: string): string {
  const path = join(mkdtempSync(join(tmpdir(), prefix)), "bot.sqlite");
  process.env.DATABASE_PATH = path;
  return path;
}

/** Заготовки гильдий: таблицы настроек ссылаются на guilds по FK. */
export async function seedGuilds(ids: string[]): Promise<void> {
  const { db } = await import("../src/db/database.ts");
  for (const id of ids) db.prepare("INSERT OR IGNORE INTO guilds(id,name,icon,updated_at) VALUES(?,?,?,?)").run(id, id, null, Date.now());
}

/** Временный DISCORD_TOKEN на время run(). */
export async function withToken<T>(token: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.DISCORD_TOKEN;
  process.env.DISCORD_TOKEN = token;
  try { return await run(); }
  finally { if (previous === undefined) delete process.env.DISCORD_TOKEN; else process.env.DISCORD_TOKEN = previous; }
}
