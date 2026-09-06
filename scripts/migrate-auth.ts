import { getMigrations } from "better-auth/db/migration";
import { auth } from "../src/lib/auth.ts";

const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
console.info("[INFO] Better Auth migrations applied");