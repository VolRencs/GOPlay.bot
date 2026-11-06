
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function useTempDb(prefix: string): string {
  const path = join(mkdtempSync(join(tmpdir(), prefix)), "bot.sqlite");
  process.env.DATABASE_PATH = path;
  return path;
}

export async function seedGuilds(ids: string[]): Promise<void> {
  const { db } = await import("../src/db/database.ts");
  for (const id of ids) db.prepare("INSERT OR IGNORE INTO guilds(id,name,icon,updated_at) VALUES(?,?,?,?)").run(id, id, null, Date.now());
}

export async function withToken<T>(token: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.DISCORD_TOKEN;
  process.env.DISCORD_TOKEN = token;
  try { return await run(); }
  finally { if (previous === undefined) delete process.env.DISCORD_TOKEN; else process.env.DISCORD_TOKEN = previous; }
}
