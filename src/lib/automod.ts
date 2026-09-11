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

// Числовые пороги детекторов: общий источник для API-валидации и полей панели.
export const automodThresholdRanges: Record<string, { min: number; max: number }> = {
  messages: { min: 2, max: 100 },
  repeatCount: { min: 2, max: 50 },
  minimumCharacters: { min: 1, max: 1000 },
  uppercasePercentage: { min: 1, max: 100 },
  maxEmojiCount: { min: 1, max: 100 },
  maxMentions: { min: 0, max: 50 },
};
export const automodWindowRange = { min: 1, max: 3600 } as const;

export type AutomodRulePutBody = {
  kind: string;
  enabled: boolean;
  actions: string[];
  threshold: Record<string, unknown>;
  window: number;
  escalation: boolean;
};
export type AutomodSecurityPutBody = {
  kind: "security";
  ignoredRoleIds: string[];
  protectedChannelId: string | null;
};
export type AutomodPutBody = AutomodRulePutBody | AutomodSecurityPutBody;

export type AutomodRuleRow = {
  kind: string; enabled: number; action_json: string; threshold_json: string;
  window_seconds: number; escalation: number;
};
export type AutomodGet = { rules: AutomodRuleRow[]; ignoredRoleIds: string[]; protectedChannelId: string | null };

export function isAutomodSecurityPutBody(body: AutomodPutBody): body is AutomodSecurityPutBody {
  return body.kind === "security";
}

export function buildRulePutBody(
  kind: string,
  rule: { enabled: number | boolean; action_json: string; threshold_json: string; window_seconds: number; escalation: number | boolean },
  parseActions: (raw: string | null | undefined) => string[],
  parseThreshold: (raw: string | null | undefined) => Record<string, unknown>,
): AutomodRulePutBody {
  return {
    kind,
    enabled: Boolean(rule.enabled),
    actions: parseActions(rule.action_json),
    threshold: parseThreshold(rule.threshold_json),
    window: rule.window_seconds,
    escalation: Boolean(rule.escalation),
  };
}