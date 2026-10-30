import type { Guild } from "discord.js";
import { stmt } from "../db/statements.ts";
import { logger } from "../lib/logger.ts";
import { localeFromDiscord } from "../lib/i18n/core.ts";
import { cachedRules } from "./config-cache.ts";

function reportRoleHierarchy(guild: Guild) {
  const highest = guild.members.me?.roles.highest;
  if (!highest || highest.id === guild.id) {
    logger.warn(`[ROLES] У бота нет отдельной роли на сервере ${guild.id}; самовыдача ролей недоступна.`);
    return;
  }
  const blocked = guild.roles.cache.filter(role => !role.managed && role.id !== guild.id && role.position >= highest.position).size;
  if (blocked) logger.warn(`[ROLES] Роль бота «${highest.name}» на сервере ${guild.id} должна быть вручную перемещена выше ${blocked} ролей для их выдачи.`);
}

export function onboardGuild(guild: Guild): void {
  const isNew = stmt.guildInsert.run(guild.id, guild.name, guild.iconURL(), Date.now()).changes > 0;
  if (isNew) stmt.guildLangUpdate.run(localeFromDiscord(guild.preferredLocale), guild.id);
  // Существующие строки не обновлялись с момента добавления бота — имя/иконка
  // в админке и DM-фолбэках оставались устаревшими после переименования сервера.
  else stmt.guildRefresh.run(guild.name, guild.iconURL(), Date.now(), guild.id);
  cachedRules(guild.id);
  reportRoleHierarchy(guild);
}
