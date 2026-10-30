export type LangCode = "ru" | "en";
export type LangDto = { lang: LangCode };

export function toDto(lang: LangCode): LangDto {
  return { lang };
}

export function fromDto(dto: LangDto): LangCode {
  return dto.lang;
}
