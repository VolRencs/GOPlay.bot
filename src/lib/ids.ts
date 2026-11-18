export const isSnowflake = (value: unknown): value is string =>
  typeof value === "string" && /^\d{15,22}$/.test(value);

export const isSnowflakeArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isSnowflake);

export const isSnowflakeOrNull = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && isSnowflake(value));
