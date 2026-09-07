import { NextResponse } from "next/server.js";
import { discordFetch, isSnowflake, requireAdmin } from "../../../../../../src/lib/guild-access.ts";
import { wipeGuildData } from "../../../../../../src/lib/server-cleanup.ts";
import { deleteGuildFiles } from "../../../../../../src/lib/uploads.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;
  const { id: guildId } = await params;
  // не-snowflake вида ".." превратил бы стирание в обход каталога загрузок.
  if (!isSnowflake(guildId)) return NextResponse.json({ error: "Некорректный идентификатор сервера." }, { status: 400 });
  const body = await request.json().catch(() => null) as { wipe?: unknown } | null;
  const wipe = Boolean(body?.wipe);

  let leftOnDiscord = true;
  try {
    const response = await discordFetch(`/users/@me/guilds/${guildId}`, { method: "DELETE" });
    if (response.status === 404) leftOnDiscord = false; // бот уже не на сервере
    else if (!response.ok) return NextResponse.json({ error: `Discord ответил ${response.status}.` }, { status: 502 });
  } catch {
    return NextResponse.json({ error: "Не удалось связаться с Discord." }, { status: 502 });
  }

  if (wipe) {
    // стирания намеренно не остаётся.
    wipeGuildData(guildId);
    // Ждём удаления файлов до ответа, иначе {wiped:true} врёт.
    try {
      await deleteGuildFiles(guildId);
    } catch {
      return NextResponse.json({ ok: true, leftOnDiscord, wiped: false, warning: "Данные стёрты, но часть файлов не удалена." });
    }
  }

  return NextResponse.json({ ok: true, leftOnDiscord, wiped: wipe });
}
