import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, isSnowflakeArray, jsonError, readJson } from "#lib/guild-access.ts";
import { automodQueries } from "#db/queries.ts";
import { safeJson, stableJson } from "#lib/json.ts";
import { automodRulesM } from "#lib/labels.ts";
import { automodActions, automodThresholdRanges, automodWindowRange } from "#lib/automod.ts";
import { fromDto, isSecurityInput, toDto, type AutomodGetDto, type AutomodInput, type AutomodRuleDto } from "#contracts/automod.ts";
import { MAX_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS } from "#lib/constants.ts";
import { stmt } from "#db/statements.ts";
import { recordDashboardDiff } from "#lib/dashboard-audit.ts";
import { AUDIT_SECTION } from "#lib/audit-sections.ts";
import { channelRef, roleRef } from "#lib/mentions.ts";

const thresholdLabels: Record<string, string> = {
  messages: "Сообщений", repeatCount: "Повторов", minimumCharacters: "Минимум букв",
  uppercasePercentage: "Заглавных %", maxEmojiCount: "Эмодзи", maxMentions: "Упоминаний",
  mode: "Режим", media: "Тип медиа", channels: "Каналы", durationSeconds: "Тайм-аут, с",
};
const modeValueLabels: Record<string, string> = {
  block_all: "блокировать все ссылки", allowlist: "разрешать только домены из списка", blocklist: "блокировать домены из списка",
  block: "блокировать приглашения", allow: "разрешать приглашения",
  any: "фото и видео", image: "только фото", video: "только видео",
};
function thresholdDisplay(threshold: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(threshold).filter(([key]) => thresholdLabels[key]).map(([key, value]) => [
    thresholdLabels[key]!,
    key === "channels" && Array.isArray(value) ? value.map(id => channelRef(String(id))) : typeof value === "string" ? (modeValueLabels[value] ?? value) : value,
  ]));
}

const kinds: readonly string[] = Object.keys(automodRulesM);
// Числовые пороги: без клампов messages:1e12 = правило-пустышка, а
// minimumCharacters:0 = ложные срабатывания. Проверяем только заданные ключи.
function isValidThreshold(threshold: Record<string, unknown>): boolean {
  for (const [key, range] of Object.entries(automodThresholdRanges)) {
    const value = threshold[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < range.min || value > range.max) return false;
  }
  return true;
}

export const GET = guildRoute(async (_, { guildId }) => {
  const security=stmt.security.get(guildId);
  const ignoredRoleIds=safeJson<unknown>(security?.ignored_role_ids_json,[]);
  const rules=automodQueries.rulesAll.all(guildId).map(toDto);
  return NextResponse.json<AutomodGetDto>({
    rules,
    ignoredRoleIds:isSnowflakeArray(ignoredRoleIds)?ignoredRoleIds:[],
    protectedChannelId:security?.protected_channel_id??null,
  });
});

export const PUT = guildRoute(async (request, { guildId, user }) => {
  const r=await readJson<AutomodInput>(request);
  if(!r||typeof r!=="object")return jsonError("Некорректный запрос.");
  // Security-исключения пишет только security-payload: сохранение одного
  // правила никогда не перетирает молча гильдейские игноры.
  if (isSecurityInput(r)) {
    const roles = r.ignoredRoleIds ?? [], channel = r.protectedChannelId ?? null;
    if(!isSnowflakeArray(roles)||(channel!==null&&(typeof channel!=="string"||!isSnowflake(channel))))return jsonError("Некорректные роли или канал.");
    const savedSecurity=stmt.security.get(guildId);
    const storedRoles=(()=>{const parsed=safeJson<unknown>(savedSecurity?.ignored_role_ids_json,[]);return isSnowflakeArray(parsed)?parsed.toSorted():[]})();
    const unchangedSecurity=savedSecurity ? stableJson(storedRoles)===stableJson([...roles].sort())&&(savedSecurity.protected_channel_id??null)===channel : roles.length===0&&channel===null;
    if(unchangedSecurity)return NextResponse.json({ok:true,unchanged:true});
    automodQueries.securityUpsert.run({ guild_id: guildId, ignored_role_ids_json: JSON.stringify(roles), protected_channel_id: channel, updated_at: Date.now() });
    recordDashboardDiff(guildId,user,AUDIT_SECTION.automod,"Общие исключения: ",
      {
        "Исключённые роли": storedRoles.map(roleRef),
        "Защищённый канал": savedSecurity?.protected_channel_id ? channelRef(savedSecurity.protected_channel_id) : null,
      },
      {
        "Исключённые роли": [...roles].map(roleRef),
        "Защищённый канал": channel ? channelRef(channel) : null,
      });
    return NextResponse.json({ok:true});
  }
  if(typeof r.threshold!=="object"||r.threshold===null||Array.isArray(r.threshold))return jsonError("Некорректные числовые пороги правила.");
  const channels=r.threshold.channels, domains=r.threshold.domains;
  if(typeof r.enabled!=="boolean"||typeof r.escalation!=="boolean")return jsonError("Некорректное состояние правила.");
  if(domains!==undefined&&(!Array.isArray(domains)||domains.some(x=>typeof x!=="string"||!x.length||x.length>253)))return jsonError("Некорректный список доменов.");
  {
    const validKind = kinds.includes(r.kind);
    const validActions = Array.isArray(r.actions) && r.actions.length > 0 && r.actions.every(x => automodActions.includes(x));
    const validWindow = Number.isInteger(r.windowSeconds) && r.windowSeconds >= automodWindowRange.min && r.windowSeconds <= automodWindowRange.max;
    const validChannels = channels === undefined || isSnowflakeArray(channels);
    if (!validKind || !validActions || !validWindow || !validChannels) {
      return jsonError("Некорректные настройки правила, ролей или канала.");
    }
  }
  if(!isValidThreshold(r.threshold))return jsonError("Некорректные числовые пороги правила.");
  if(JSON.stringify(r.threshold).length>10000)return jsonError("Слишком большой список порогов.");
  const duration=Number(r.threshold.durationSeconds??DEFAULT_TIMEOUT_SECONDS); if(!Number.isFinite(duration)||duration<1||duration>MAX_TIMEOUT_SECONDS)return jsonError("Тайм-аут может длиться от 1 секунды до 28 дней.");
  const existingRule=automodQueries.ruleGet.get(guildId,r.kind);
  const currentRule: AutomodRuleDto | null = existingRule ? toDto({ ...existingRule, kind: r.kind }) : null;
  if(currentRule){
    const unchangedRule=currentRule.enabled===r.enabled&&currentRule.windowSeconds===r.windowSeconds&&currentRule.escalation===r.escalation&&stableJson(currentRule.actions)===stableJson(r.actions)&&stableJson(currentRule.threshold)===stableJson(r.threshold);
    if(unchangedRule)return NextResponse.json({ok:true,unchanged:true});
  }
  const ruleRow = fromDto(r);
  automodQueries.ruleUpsert.run({ guild_id: guildId, kind: r.kind, enabled: ruleRow.enabled, action_json: ruleRow.action_json, threshold_json: ruleRow.threshold_json, window_seconds: ruleRow.window_seconds, escalation: ruleRow.escalation, updated_at: Date.now() });
  const payload=(rule: AutomodRuleDto)=>({
    "Включено":rule.enabled, "Действия":rule.actions, "Окно, с":rule.windowSeconds, "Эскалация":rule.escalation, ...thresholdDisplay(rule.threshold),
  });
  recordDashboardDiff(guildId,user,AUDIT_SECTION.automod,`Правило «${automodRulesM[r.kind]?.title.ru ?? r.kind}»: `,
    currentRule?payload(currentRule):{},
    payload(r));
  return NextResponse.json({ok:true});
});
