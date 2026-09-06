import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { embedUploadsDir, eventUploadsDir } from "../../../../../src/lib/uploads.ts";
import { requireUser } from "../../../../../src/lib/guild-access.ts";

const contentTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

export async function GET(_: Request, { params }: { params: Promise<{ kind: string; guildId: string; filename: string }> }) {
  const { kind, guildId, filename } = await params;
  if ((kind !== "embeds" && kind !== "events") || !/^\d+$/.test(guildId) || !filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) return new Response(null, { status: 404 });
  // Загрузки модераторов — не публичный контент «по угаданному URL»: читать
  // могут только пользователи панели (<img> в дашборде шлёт cookies сам).
  try {
    const gate = await requireUser();
    if (!gate.ok) return new Response(null, { status: gate.status });
  } catch {
    return new Response(null, { status: 401 });
  }
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const type = contentTypes[ext];
  if (!type) return new Response(null, { status: 404 });
  try {
    const dir = kind === "embeds" ? embedUploadsDir(guildId) : eventUploadsDir(guildId);
    const bytes = await readFile(join(dir, filename));
    // Имя файла содержит timestamp и никогда не перезаписывается: контент
    // неизменяем, браузер может кэшировать навсегда.
    return new Response(bytes, { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
