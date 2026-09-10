import { NextResponse } from "next/server.js";
import { adminRoute, discordFetch, isSnowflake, jsonError, readJson } from "../../../../../../src/lib/guild-access.ts";
import { wipeGuildData } from "../../../../../../src/lib/server-cleanup.ts";
import { deleteGuildFiles } from "../../../../../../src/lib/uploads.ts";

export const POST = adminRoute<{ id: string }>(async (request, { id: guildId }) => {
  if (!isSnowflake(guildId)) return jsonError("Некорректный идентификатор сервера.");
  const body = await readJson<{ wipe?: unknown }>(request);
  const wipe = Boolean(body?.wipe);

  let leftOnDiscord = true;
  try {
    const response = await discordFetch(`/users/@me/guilds/${guildId}`, { method: "DELETE" });
    if (response.status === 404) leftOnDiscord = false; // бот уже не на сервере
    else if (!response.ok) return jsonError(`Discord ответил ${response.status}.`, 502);
  } catch {
    return jsonError("Не удалось связаться с Discord.", 502);
  }

  if (wipe) {
    wipeGuildData(guildId);
    // Ждём удаления файлов до ответа, иначе {wiped:true} врёт.
    try {
      await deleteGuildFiles(guildId);
    } catch {
      return NextResponse.json({ ok: true, leftOnDiscord, wiped: false, warning: "Данные стёрты, но часть файлов не удалена." });
    }
  }

  return NextResponse.json({ ok: true, leftOnDiscord, wiped: wipe });
});
