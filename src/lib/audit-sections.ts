/** Единственный список разделов журнала: роуты и фильтр панели не расходятся. */
export const AUDIT_SECTION = {
  appeals: "Апелляции",
  automod: "Автомодерация",
  embeds: "Embeds",
  events: "События",
  logging: "Логи",
  welcome: "Приветствие",
  roles: "Роли",
  tempchannels: "Временные каналы",
  cleanup: "Очистка",
  settings: "Настройки",
  music: "Музыка",
  levels: "Уровни",
} as const;

export const AUDIT_SECTIONS = Object.values(AUDIT_SECTION);
