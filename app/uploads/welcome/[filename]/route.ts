import { serveUploadFile, WELCOME_CONTENT_TYPES as contentTypes, welcomeUploadsDir } from "#lib/uploads.ts";

// Фон приветствия пишется в public/uploads/welcome уже после сборки, а Next в
// production отдаёт из public только файлы, перечисленные на старте сервера.
// Этот роут читает файл с диска в рантайме (статический public по-прежнему в
// приоритете для файлов, попавших в сборку).
export async function GET(_: Request, context: RouteContext<"/uploads/welcome/[filename]">) {
  const { filename } = await context.params;
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const type = contentTypes[ext];
  if (!type || !/^\d{15,22}-welcome\.[a-z0-9]+$/i.test(filename)) return new Response(null, { status: 404 });
  return serveUploadFile(welcomeUploadsDir(), filename, type, "public, max-age=3600", { "x-content-type-options": "nosniff" });
}
