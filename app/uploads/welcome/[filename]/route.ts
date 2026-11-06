import { serveUploadFile, WELCOME_CONTENT_TYPES as contentTypes, welcomeUploadsDir } from "#lib/uploads.ts";

export async function GET(_: Request, context: RouteContext<"/uploads/welcome/[filename]">) {
  const { filename } = await context.params;
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const type = contentTypes[ext];
  if (!type || !/^\d{15,22}-welcome\.[a-z0-9]+$/i.test(filename)) return new Response(null, { status: 404 });
  return serveUploadFile(welcomeUploadsDir(), filename, type, "public, max-age=3600", { "x-content-type-options": "nosniff" });
}
