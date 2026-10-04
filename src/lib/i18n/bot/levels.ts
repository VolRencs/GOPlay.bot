import { makeTr, commonMessages } from "../bot.ts";

export const levelsTr = makeTr({
  ...commonMessages,
  disabled: { ru: "Система уровней на этом сервере выключена.", en: "The level system is disabled on this server." },
  memberNotFound: { ru: "❌ Участник не найден на сервере.", en: "❌ Member not found on this server." },
  title: { ru: "Уровень {user}", en: "{user}'s level" },
  fieldLevel: { ru: "Уровень", en: "Level" },
  fieldProgress: { ru: "Прогресс", en: "Progress" },
  fieldTotalXp: { ru: "Всего XP", en: "Total XP" },
  fieldMessages: { ru: "Сообщений", en: "Messages" },
  fieldVoice: { ru: "В голосе", en: "Voice time" },
  fieldRank: { ru: "Место в топе", en: "Server rank" },
  rankValue: { ru: "#{rank}", en: "#{rank}" },
  progressValue: { ru: "{a} / {b} XP", en: "{a} / {b} XP" },
  maxLevelValue: { ru: "Максимальный уровень", en: "Max level" },
  voiceTime: { ru: "{h} ч {m} мин", en: "{h}h {m}m" },
  topTitle: { ru: "🏆 Топ сервера по XP", en: "🏆 XP leaderboard" },
  topEmpty: { ru: "Пока никто не заработал XP.", en: "No one has earned XP yet." },
  topLine: { ru: "{rank}. {user} — уровень {level} · {xp} XP", en: "{rank}. {user} — level {level} · {xp} XP" },
  levelUp: { ru: "🎉 {user} достиг **{level}** уровня на сервере «{server}»!", en: "🎉 {user} reached level **{level}** on \"{server}\"!" },
});
