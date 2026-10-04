// Discord snowflake: 15–22 цифры. Отдельный чистый модуль без next/headers,
// чтобы бот и панель импортировали один предикат (guild-access тянет Next).
export const isSnowflake = (value: string) => /^\d{15,22}$/.test(value);

export const isSnowflakeArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === "string" && isSnowflake(item));
