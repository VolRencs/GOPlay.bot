import { NextResponse } from "next/server.js";
import { adminRoute, discordFetch, isSnowflake, jsonError, readJsonRecord } from "#lib/guild-access.ts";
import { wipeGuildData } from "#lib/server-cleanup.ts";
import { deleteGuildFiles } from "#lib/uploads.ts";

export const POST = adminRoute<{ id: string }>(async (request, { id: guildId }) => {
  if (!isSnowflake(guildId)) return jsonError("Некорректный идентификатор сервера.");
  const body = await readJsonRecord(request);
  const wipe = body?.wipe === true;

  let leftOnDiscord = true;
  try {
    const response = await discordFetch(`/users/@me/guilds/${guildId}`, { method: "DELETE" });
    if (response.status === 404) leftOnDiscord = false;
    else if (!response.ok) return jsonError(`Discord ответил ${response.status}.`, 502);
  } catch {
    return jsonError("Не удалось связаться с Discord.", 502);
  }

  if (wipe) wipeGuildData(guildId);
  const fileErrors = wipe ? await deleteGuildFiles(guildId) : [];

  return NextResponse.json({
    ok: true,
    leftOnDiscord,
    wiped: wipe && fileErrors.length === 0,
    ...(fileErrors.length ? { warning: `Данные в БД удалены, но не удалось удалить: ${fileErrors.join(", ")}.` } : {}),
  });
});
