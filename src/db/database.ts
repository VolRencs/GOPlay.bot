import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const moduleDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const projectRoot = join(moduleDir, "../..");
const configuredPath = process.env.DATABASE_PATH ?? "data/bot.sqlite";
const path = isAbsolute(configuredPath) ? configuredPath : join(projectRoot, configuredPath);
mkdirSync(dirname(path), { recursive: true });
// WAL lets dashboard reads run while the bot writes.
export const db = new DatabaseSync(path, { timeout: 5000 });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -8192;");
db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
const migrations = join(moduleDir, "migrations");
let txDepth = 0;
for (const name of readdirSync(migrations).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get(name)) break;
    try {
      withTransaction(() => {
        db.exec(readFileSync(join(migrations, name), "utf8"));
        db.prepare("INSERT INTO _migrations VALUES (?,?)").run(name, Date.now());
      });
      break;
    } catch (error) {
      if (db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get(name)) break;
      if (attempt === 3) throw error;
      await sleep(50 * (attempt + 1));
    }
  }
}
function syncAutoroleSchema() {
  db.exec(`CREATE TABLE IF NOT EXISTS autorole_settings (
    guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0,
    role_id TEXT,
    updated_at INTEGER NOT NULL
  )`);
  const columns = db.prepare("PRAGMA table_info(autorole_settings)").all().map(row => row.name).filter((name): name is string => typeof name === "string");
  if (columns.includes("role_id") || !columns.includes("role_ids_json")) return;
  withTransaction(() => {
    db.exec("ALTER TABLE autorole_settings ADD COLUMN role_id TEXT");
    db.exec("UPDATE autorole_settings SET role_id = json_extract(role_ids_json, '$[0]')");
  });
}
syncAutoroleSchema();

export function closeDatabase() { db.close(); }

// Nested calls use savepoints; top-level BEGIN IMMEDIATE avoids lock-upgrade deadlocks.
export function withTransaction<T>(fn: () => T): T {
  if (txDepth > 0) {
    txDepth++;
    const savepoint = `sp_${txDepth}`;
    try {
      db.exec(`SAVEPOINT ${savepoint}`);
      const result = fn();
      db.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO ${savepoint}`); db.exec(`RELEASE ${savepoint}`); } catch {  }
      throw error;
    } finally { txDepth--; }
  }
  db.exec("BEGIN IMMEDIATE");
  txDepth++;
  try { const result = fn(); db.exec("COMMIT"); return result; }
  catch (error) { try { db.exec("ROLLBACK"); } catch {  } throw error; }
  finally { txDepth--; }
}
