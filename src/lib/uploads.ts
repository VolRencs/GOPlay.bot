import { readFile, readdir, rm, stat, unlink } from "node:fs/promises";
import { join, sep } from "node:path";

export const embedUploadsDir = (guildId: string) => join(process.cwd(), "data", "uploads", "embeds", guildId);
export const embedUploadPrefix = (guildId: string) => `/uploads/embeds/${guildId}/`;
export const eventUploadsDir = (guildId: string) => join(process.cwd(), "data", "uploads", "events", guildId);
export const eventUploadPrefix = (guildId: string) => `/uploads/events/${guildId}/`;
export const welcomeUploadsDir = () => join(process.cwd(), "data", "uploads", "welcome");
export const WELCOME_UPLOAD_PREFIX = "/uploads/welcome/";

export const UPLOAD_CONTENT_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
export const WELCOME_CONTENT_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
export const WELCOME_IMAGE_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function filenameFromUrl(prefix: string, url: string | null | undefined): string | null {
  if (!url?.startsWith(prefix)) return null;
  const filename = url.slice(prefix.length);
  if (!filename || filename.includes("/") || filename.includes("\\")) return null;
  if (filename === "." || filename === "..") return null;
  return filename;
}

export function extractFilenames(prefix: string, urls: (string | null | undefined)[]): string[] {
  return [...new Set(urls.flatMap(url => {
    const filename = filenameFromUrl(prefix, url);
    return filename ? [filename] : [];
  }))];
}

// Serve only a bare filename inside dir; reject path traversal.
export async function serveUploadFile(dir: string, filename: string, contentType: string, cacheControl: string, headers: Record<string, string> = {}): Promise<Response> {
  try {
    const path = join(dir, filename);
    if (!path.startsWith(dir + sep)) return new Response(null, { status: 404 });
    const bytes = await readFile(path);
    return new Response(bytes, { headers: { "content-type": contentType, "cache-control": cacheControl, ...headers } });
  } catch {
    return new Response(null, { status: 404 });
  }
}

export async function cleanupUnusedUploads<T>(dir: string, rows: Iterable<T>, filenamesOf: (row: T) => string[], minAgeMs = 0): Promise<void> {
  const referenced = new Set<string>();
  for (const row of rows) for (const filename of filenamesOf(row)) referenced.add(filename);
  await cleanupOrphanedFiles(dir, referenced, minAgeMs);
}

async function cleanupOrphanedFiles(dir: string, referenced: Set<string>, minAgeMs = 0): Promise<void> {
  try {
    const now = Date.now();
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if ((entry.isFile() || entry.isSymbolicLink()) && !referenced.has(entry.name)) {
        if (minAgeMs > 0) {
          const info = await stat(join(dir, entry.name)).catch(() => null);
          if (info && now - info.mtimeMs < minAgeMs) continue;
        }
        await unlink(join(dir, entry.name)).catch(() => null);
      }
    }
  } catch {  }
}

export async function deleteWelcomeBackgrounds(guildId: string, keep?: string) {
  const dir = welcomeUploadsDir();
  const files = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(files.filter(name => name.startsWith(`${guildId}-welcome.`) && name !== keep).map(name => unlink(join(dir, name)).catch(() => null)));
}

export async function deleteGuildFiles(guildId: string) {
  await rm(embedUploadsDir(guildId), { recursive: true, force: true }).catch(() => null);
  await rm(eventUploadsDir(guildId), { recursive: true, force: true }).catch(() => null);
  await deleteWelcomeBackgrounds(guildId);
}

// formData()/json() buffer the whole body before per-file limits, so reject early.
export function rejectOversized(request: Request, limitBytes = 32 * 1024 * 1024): Response | null {
  const raw = request.headers.get("content-length");
  if (raw === null) {
    return new Response(JSON.stringify({ error: "Не удалось определить размер запроса." }), { status: 411, headers: { "content-type": "application/json" } });
  }
  const len = Number(raw);
  if (!Number.isFinite(len) || len < 0 || !Number.isInteger(len)) {
    return new Response(JSON.stringify({ error: "Некорректный размер запроса." }), { status: 400, headers: { "content-type": "application/json" } });
  }
  if (len > limitBytes) return new Response(JSON.stringify({ error: "Запрос слишком большой." }), { status: 413, headers: { "content-type": "application/json" } });
  return null;
}
