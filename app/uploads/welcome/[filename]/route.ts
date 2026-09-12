import { readFile } from "node:fs/promises";
import { join } from "node:path";

const contentTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

// Фон приветствия пишется в public/uploads/welcome уже после сборки, а Next в
// production отдаёт из public только файлы, перечисленные на старте сервера.
// Этот роут читает файл с диска в рантайме (статический public по-прежнему в
// приоритете для файлов, попавших в сборку).
export async function GET(_: Request, context: RouteContext<"/uploads/welcome/[filename]">) {
  const { filename } = await context.params;
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const type = contentTypes[ext];
  if (!type || !/^\d{15,22}-welcome\.[a-z0-9]+$/i.test(filename)) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(join(process.cwd(), "public", "uploads", "welcome", filename));
    return new Response(bytes, { headers: { "content-type": type, "cache-control": "public, max-age=3600" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
