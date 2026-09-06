export type Locale = "ru" | "en";
export type Bi = Record<Locale, string>;

export function localeFromDiscord(preferred: string | null | undefined): Locale {
  return preferred?.startsWith("en") ? "en" : "ru";
}
