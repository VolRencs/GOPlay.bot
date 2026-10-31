import { automodDefaultActions, automodThresholdDefaults } from "../lib/automod.ts";
import { DEFAULT_TIMEOUT_SECONDS } from "../lib/constants.ts";
import { parseActions, safeJson } from "../lib/json.ts";

export type AutomodRuleDto = {
  kind: string;
  enabled: boolean;
  actions: string[];
  threshold: Record<string, unknown>;
  windowSeconds: number;
  escalation: boolean;
};

export type AutomodGetDto = {
  rules: AutomodRuleDto[];
  ignoredRoleIds: string[];
  protectedChannelId: string | null;
};

export type AutomodSecurityInput = { kind: "security"; ignoredRoleIds: string[]; protectedChannelId: string | null };
export type AutomodInput = AutomodRuleDto | AutomodSecurityInput;

export type AutomodRuleDomain = {
  kind: string;
  enabled: number;
  action_json: string;
  threshold_json: string;
  window_seconds: number;
  escalation: number;
};

export function toDto(row: AutomodRuleDomain): AutomodRuleDto {
  const parsed = safeJson<unknown>(row.threshold_json, {});
  return {
    kind: row.kind,
    enabled: Boolean(row.enabled),
    actions: parseActions(row.action_json),
    threshold: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {},
    windowSeconds: row.window_seconds,
    escalation: Boolean(row.escalation),
  };
}

export function fromDto(dto: AutomodRuleDto): AutomodRuleDomain {
  return {
    kind: dto.kind,
    enabled: Number(dto.enabled),
    action_json: JSON.stringify(dto.actions),
    threshold_json: JSON.stringify(dto.threshold),
    window_seconds: dto.windowSeconds,
    escalation: Number(dto.escalation),
  };
}

export function defaultRule(kind: string): AutomodRuleDto {
  return {
    kind,
    enabled: false,
    actions: [...automodDefaultActions],
    threshold: { ...(automodThresholdDefaults as Record<string, Record<string, unknown>>)[kind] ?? {}, durationSeconds: DEFAULT_TIMEOUT_SECONDS },
    windowSeconds: 10,
    escalation: false,
  };
}

export function isSecurityInput(body: AutomodInput): body is AutomodSecurityInput {
  return body.kind === "security";
}
