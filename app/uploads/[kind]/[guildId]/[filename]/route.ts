import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { embedUploadsDir, eventUploadsDir } from "../../../../../src/lib/uploads.ts";
import { guildRoute, isSnowflake } from "../../../../../src/lib/guild-access.ts";

const contentTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
// Только простое имя файла: сегмент [filename] декодирует %2f, поэтому
// «../../../secret.png» иначе дошёл бы до readFile.
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const GET = guildRoute<{ kind: string; guildId: string; filename: string }>(async (_, { guildId, params }) => {
  const { kind, filename } = params;
  if ((kind !== "embeds" && kind !== "events") || !isSnowflake(guildId) || !SAFE_FILENAME.test(filename)) return new Response(null, { status: 404 });
  // Загрузки модераторов — не публичный контент «по угаданному URL»: читать
  // могут только пользователи панели (<img> в дашборде шлёт cookies сам).
  // Проверяем доступ именно к этой гильдии, иначе кросс-гильд IDOR.
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const type = contentTypes[ext];
  if (!type) return new Response(null, { status: 404 });
  try {
    const dir = kind === "embeds" ? embedUploadsDir(guildId) : eventUploadsDir(guildId);
    const path = join(dir, filename);
    if (!path.startsWith(dir + sep)) return new Response(null, { status: 404 });
    const bytes = await readFile(path);
    // Имя файла содержит timestamp и никогда не перезаписывается: контент
    // неизменяем, браузер может кэшировать навсегда.
    return new Response(bytes, { headers: { "content-type": type, "cache-control": "private, max-age=31536000, immutable" } });
  } catch {
    return new Response(null, { status: 404 });
  }
});
