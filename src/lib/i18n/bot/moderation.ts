import { makeTr } from "../bot.ts";

export const trModeration = makeTr({
  notGuild: { ru: "❌ Команда доступна только на сервере.", en: "❌ This command is only available in a server." },
  noPermsTarget: { ru: "❌ Нельзя управлять этим пользователем: проверьте иерархию ролей.", en: "❌ Cannot moderate this user: check role hierarchy." },
  noPermsGeneric: { ru: "❌ У бота недостаточно прав или ресурс был удалён.", en: "❌ The bot lacks permissions or the resource was deleted." },
  noReason: { ru: "Без причины", en: "No reason" },
  warnListEmpty: { ru: "Активных предупреждений нет.", en: "No active warnings." },
  clearwarnNeedTarget: { ru: "Укажите пользователя (user) или включите снятие всех предупреждений сервера (all).", en: "Specify a user (user) or enable clearing all server warnings (all)." },
  clearwarnExclusive: { ru: "Выберите что-то одно: пользователя (user) или все предупреждения сервера (all).", en: "Pick one: a user (user) or all server warnings (all)." },
  clearwarnNoneUser: { ru: "У пользователя {user} нет предупреждений.", en: "{user} has no warnings." },
  clearwarnDone: { ru: "✅ Снято предупреждений: {n}{target}.", en: "✅ Warnings cleared: {n}{target}." },
  targetUser: { ru: " у {user}", en: " from {user}" },
  targetAll: { ru: " (все на сервере)", en: " (whole server)" },
  purgeDone: { ru: "✅ Удалено {n}; сообщения старше 14 дней пропущены.", en: "✅ Deleted {n}; messages older than 14 days were skipped." },
  needTextChannel: { ru: "❌ Нужен текстовый канал.", en: "❌ A text channel is required." },
  channelUpdated: { ru: "✅ Настройки канала обновлены.", en: "✅ Channel settings updated." },
  logPurge: { ru: "Удалено сообщений: {n}", en: "Messages deleted: {n}" },
  logWarnClear: { ru: "Снято предупреждений: {n}", en: "Warnings cleared: {n}" },
  logTimeout: { ru: "Тайм-аут: {min} мин. Причина: {reason}", en: "Timeout: {min} min. Reason: {reason}" },
  logReason: { ru: "Причина: {reason}", en: "Reason: {reason}" },
});
