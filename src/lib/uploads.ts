import { readdir, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export const embedUploadsDir = (guildId: string) => join(process.cwd(), "data", "uploads", "embeds", guildId);
export const embedUploadPrefix = (guildId: string) => `/uploads/embeds/${guildId}/`;
export const eventUploadsDir = (guildId: string) => join(process.cwd(), "data", "uploads", "events", guildId);
export const eventUploadPrefix = (guildId: string) => `/uploads/events/${guildId}/`;

// Имя файла из локального URL: null, если URL не из этого каталога или содержит
// разделители путей. Единая проверка для uploads/assets/бот-переотправки.
export function filenameFromUrl(prefix: string, url: string | null | undefined): string | null {
  if (!url?.startsWith(prefix)) return null;
  const filename = url.slice(prefix.length);
  return !filename || filename.includes("/") || filename.includes("\\") ? null : filename;
}

export function extractFilenames(prefix: string, urls: (string | null | undefined)[]): string[] {
  return [...new Set(urls.flatMap(url => {
    const filename = filenameFromUrl(prefix, url);
    return filename ? [filename] : [];
  }))];
}

export async function cleanupOrphanedFiles(dir: string, referenced: Set<string>, minAgeMs = 0): Promise<void> {
  try {
    const now = Date.now();
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if ((entry.isFile() || entry.isSymbolicLink()) && !referenced.has(entry.name)) {
        // minAgeMs защищает от гонки: файл мог быть записан параллельным
        // запросом, который ещё не сохранил ссылку в БД.
        if (minAgeMs > 0) {
          const info = await stat(join(dir, entry.name)).catch(() => null);
          if (info && now - info.mtimeMs < minAgeMs) continue;
        }
        await unlink(join(dir, entry.name)).catch(() => null);
      }
    }
  } catch { /* directory may not exist */ }
}

// Локальные файлы сервера: вложения embeds/events и фон приветствия.
export async function deleteGuildFiles(guildId: string) {
  await rm(embedUploadsDir(guildId), { recursive: true, force: true }).catch(() => null);
  await rm(eventUploadsDir(guildId), { recursive: true, force: true }).catch(() => null);
  const dir = join(process.cwd(), "public", "uploads", "welcome");
  const files = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(files.filter(name => name.startsWith(`${guildId}-welcome.`)).map(name => unlink(join(dir, name)).catch(() => null)));
}

/** Ранний отказ по размеру запроса: formData()/json() буферизуют всё тело в
 *  памяти ДО per-file проверки лимита, поэтому без этой проверки аутентифицированный
 *  пользователь мог выкачать гигабайты в RAM процесса (параллельные запросы = OOM).
 *  nginx в проде режет на 8 MB — это защита прямого доступа к Next. */
export function rejectOversized(request: Request, limitBytes = 32 * 1024 * 1024): Response | null {
  const raw = request.headers.get("content-length");
  // Chunked multipart без content-length буферизуется formData() безлимитно:
  // заголовок не проверить, поэтому отказываем. Браузерный FormData его шлёт.
  if (raw === null && request.headers.get("content-type")?.includes("multipart/form-data")) {
    return new Response(JSON.stringify({ error: "Не удалось определить размер запроса." }), { status: 411, headers: { "content-type": "application/json" } });
  }
  const len = Number(raw ?? 0);
  if (Number.isFinite(len) && len > limitBytes) return new Response(JSON.stringify({ error: "Запрос слишком большой." }), { status: 413, headers: { "content-type": "application/json" } });
  return null;
}
