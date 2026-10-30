export type RuleKind = "spam" | "duplicate" | "caps" | "emoji" | "mentions" | "links" | "invites" | "links_only" | "media_only";
// Общий для бота и панели валидации: оба слоя не могут разойтись во множестве
export const automodActions: readonly string[] = ["delete", "warn", "timeout", "kick", "ban"];
// Нейтральный дефолт правила без явного набора мер: его же подставляет
// парсер (json.ts) и бот при пустом или битом action_json.
export const automodDefaultActions: readonly string[] = ["delete", "warn"];
export const automodThresholdDefaults: Record<RuleKind, Record<string, unknown>> = {
  spam: { messages: 5 },
  duplicate: { repeatCount: 3 },
  caps: { minimumCharacters: 10, uppercasePercentage: 70 },
  emoji: { maxEmojiCount: 8 },
  mentions: { maxMentions: 5 },
  links: { mode: "block_all", channels: [] },
  invites: { mode: "block" },
  links_only: { channels: [] },
  media_only: { channels: [], media: "any" },
};

// Числовые пороги детекторов: общий источник для API-валидации и полей панели.
export const automodThresholdRanges = {
  messages: { min: 2, max: 100 },
  repeatCount: { min: 2, max: 50 },
  minimumCharacters: { min: 1, max: 1000 },
  uppercasePercentage: { min: 1, max: 100 },
  maxEmojiCount: { min: 1, max: 100 },
  maxMentions: { min: 0, max: 50 },
} as const satisfies Record<string, { min: number; max: number }>;
export type AutomodThresholdKey = keyof typeof automodThresholdRanges;
export const automodWindowRange = { min: 1, max: 3600 } as const;
