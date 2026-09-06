export type RuleKind = "spam" | "duplicate" | "caps" | "emoji" | "mentions" | "links" | "invites" | "links_only" | "media_only";
// Общий для бота и панели валидации: оба слоя не могут разойтись во множестве
export const automodActions: readonly string[] = ["delete", "warn", "timeout", "kick", "ban"];
// Нейтральный дефолт правила без явного набора мер: парсер (json.ts),
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