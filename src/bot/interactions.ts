import { Events, MessageFlags, type ButtonInteraction, type Client, type Interaction, type StringSelectMenuInteraction } from "discord.js";
import { handleChatCommand } from "./commands.ts";
import { handleLevelCommand } from "./levels/index.ts";
import { handleMusicCommand } from "./music/index.ts";
import { trModeration } from "../lib/i18n/bot/moderation.ts";
import { automodTr, guildLang, guildTr } from "../lib/i18n/bot.ts";
import { failInteraction } from "../lib/errors.ts";
import { fetchMember } from "./utils/members.ts";
import { applyPanelRoleSafe, panelNotifies } from "./self-roles.ts";
import { count } from "../lib/perf.ts";
import { on } from "./events.ts";

export function registerInteractions(client: Client): void {
  on(client, Events.InteractionCreate, "INTERACTION", i => routeInteraction(i));
}

async function handleRoleInteraction(i: ButtonInteraction | StringSelectMenuInteraction, panelId: number, roleIds: string[]): Promise<void> {
  const member = i.guild ? await fetchMember(i.guild, i.user.id) : null;
  if (!member || !Number.isInteger(panelId) || panelId < 1) return;
  // Ответ подтверждаем ДО выдачи роли: операция идёт через REST и может
  // занять больше 3 секунд, после которых Discord считает интеракцию
  // просроченной и сообщение не показывается вовсе.
  if (panelNotifies(i.guildId!, panelId)) await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  else await i.deferUpdate().catch(() => null);
  const results = await Promise.all(roleIds.map(roleId => applyPanelRoleSafe(i.guildId!, panelId, roleId, member)));
  const messages = results.filter(result => result.notify).map(result => result.text);
  if (messages.length) await i.editReply({ content: messages.join("\n") }).catch(() => null);
}

async function routeInteraction(i: Interaction) {
  try {
    // guildLang читает БД — внутри try, иначе ошибка оставляла бы интеракцию
    // без ответа (пользователь видит «думает…»).
    const cmdLang = guildLang(i.guildId ?? "");
    count("events.interaction");
    if (await handleMusicCommand(i)) return;
    if (await handleLevelCommand(i)) return;
    if (i.isChatInputCommand()) {
      // Неизвестная команда (её нельзя вызвать из Discord, но подстраховка):
      // отвечаем явно, а не уводим в обработчик модерации.
      if (!await handleChatCommand(i)) await i.reply({ content: trModeration(cmdLang, "genericError"), flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    if (i.isButton() && i.customId.startsWith("role:")) {
      const [, id, roleId] = i.customId.split(":");
      if (id && roleId) await handleRoleInteraction(i, Number(id), [roleId]);
    }
    if (i.isStringSelectMenu() && i.customId.startsWith("roles:")) {
      await handleRoleInteraction(i, Number(i.customId.split(":")[1]), i.values);
    }
  } catch (error) {
    failInteraction("[INTERACTION] Обработка взаимодействия не удалась", i, error, guildTr(automodTr, i.guildId ?? "")("genericError"), i.guildId ?? "dm");
  }
}
