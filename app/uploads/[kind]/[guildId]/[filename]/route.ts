import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { embedUploadsDir, eventUploadsDir } from "../../../../../src/lib/uploads.ts";
import { guildRoute, isSnowflake } from "../../../../../src/lib/guild-access.ts";

const contentTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

export const GET = guildRoute<{ kind: string; guildId: string; filename: string }>(async (_, { guildId, params }) => {
  const { kind, filename } = params;
  if ((kind !== "embeds" && kind !== "events") || !isSnowflake(guildId) || !filename) return new Response(null, { status: 404 });
  // Загрузки модераторов — не публичный контент «по угаданному URL»: читать
  // могут только пользователи панели (<img> в дашборде шлёт cookies сам).
  // Проверяем доступ именно к этой гильдии, иначе кросс-гильд IDOR.
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const type = contentTypes[ext];
  if (!type) return new Response(null, { status: 404 });
  try {
    const dir = kind === "embeds" ? embedUploadsDir(guildId) : eventUploadsDir(guildId);
    const resolved = resolve(dir, filename);
    if (resolved !== join(dir, filename) && !resolved.startsWith(dir + "/")) return new Response(null, { status: 404 });
    const bytes = await readFile(resolved);
    // Имя файла содержит timestamp и никогда не перезаписывается: контент
    // неизменяем, браузер может кэшировать навсегда.
    return new Response(bytes, { headers: { "content-type": type, "cache-control": "private, max-age=31536000, immutable" } });
  } catch {
    return new Response(null, { status: 404 });
  }
});
