import type { GuildMember } from "discord.js";
import { welcomeImage } from "./utils/welcome-image.ts";
import { renderWelcomeTemplate, welcomeValues, type WelcomeGet } from "../lib/welcome.ts";
import { stmt } from "../db/statements.ts";
import { resolveChannel } from "./logging/index.ts";
import { logger } from "../lib/logger.ts";
import { time } from "../lib/perf.ts";
import { userRef } from "../lib/mentions.ts";

function memberTemplate(template: string, member: GuildMember) {
  return renderWelcomeTemplate(template.replace(/\r\n?/g, "\n"), {
    ...welcomeValues({ name: member.displayName, username: member.user.username, userId: member.id, server: member.guild.name, count: member.guild.memberCount, avatar: member.user.displayAvatarURL() }),
    user: userRef(member.id),
    serverIcon: member.guild.iconURL() ?? "",
  });
}

async function renderMemberImage(member: GuildMember, setting: WelcomeGet, event: "welcome" | "goodbye") {
  const started = performance.now();
  try {
    return await welcomeImage({
      avatar: member.user.displayAvatarURL({ extension: "png" }),
      name: member.displayName,
      username: member.user.username,
      userId: member.id,
      server: member.guild.name,
      count: member.guild.memberCount,
      backgroundPath: setting.background_path,
      config: setting.image_config_json,
    });
  } catch (error) {
    logger.warn(`[${event}] Рендер изображения не удался`, member.guild.id, error);
    return null;
  } finally {
    time("welcome.render", performance.now() - started);
  }
}

/** Приветствие/прощание участника: текст шаблона и опциональная картинка. */
export async function sendMemberEvent(member: GuildMember, event: "welcome" | "goodbye") {
  const setting = stmt.welcomeSettings.get(member.guild.id) as WelcomeGet | undefined;
  const welcome = event === "welcome";
  const enabled = welcome ? setting?.enabled : setting?.goodbye_enabled;
  const channelId = welcome ? setting?.channel_id : setting?.goodbye_channel_id;
  if (!setting || !enabled || !channelId) return;
  // Сначала резолвим канал: рендерить картинку для удалённого канала нечего.
  const channel = await resolveChannel(channelId);
  if (!channel) return;
  const content = memberTemplate(welcome ? setting.message : setting.goodbye_message, member).slice(0, 2000) || "\u200b";
  const image = welcome && setting.image_enabled ? await renderMemberImage(member, setting, event) : null;
  // Ник участника — пользовательские данные: без allowedMentions шаблон с
  // «{displayName}» разослал бы @everyone всему серверу.
  await channel.send({ content, allowedMentions: { parse: [], users: [member.id] }, ...(image ? { files: [{ attachment: image, name: "welcome.png" }] } : {}) }).catch(error => logger.warn(`[${event}] Доставка сообщения не удалась`, member.guild.id, error));
}
