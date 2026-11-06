export const isSnowflake = (value: string) => /^\d{15,22}$/.test(value);

export const isSnowflakeArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === "string" && isSnowflake(item));

export const isSnowflakeOrNull = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && isSnowflake(value));
