import { embedUploadsDir, eventUploadsDir, serveUploadFile, UPLOAD_CONTENT_TYPES as contentTypes } from "#lib/uploads.ts";
import { guildRoute, isSnowflake } from "#lib/guild-access.ts";
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const GET = guildRoute<{ kind: string; guildId: string; filename: string }>(async (_, { guildId, params }) => {
  const { kind, filename } = params;
  if ((kind !== "embeds" && kind !== "events") || !isSnowflake(guildId) || !SAFE_FILENAME.test(filename)) return new Response(null, { status: 404 });
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const type = contentTypes[ext];
  if (!type) return new Response(null, { status: 404 });
  const dir = kind === "embeds" ? embedUploadsDir(guildId) : eventUploadsDir(guildId);
  return serveUploadFile(dir, filename, type, "private, max-age=31536000, immutable");
});
