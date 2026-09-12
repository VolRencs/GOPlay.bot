import { NextResponse } from "next/server.js";
import { guildRoute, isSnowflake, isSnowflakeArray, jsonError, readJson } from "../../../../../src/lib/guild-access.ts";
import { db } from "../../../../../src/db/database.ts";
import { safeJson, stableJson } from "../../../../../src/lib/json.ts";
import { automodRulesM } from "../../../../../src/lib/labels.ts";
import { automodActions, automodThresholdRanges, automodWindowRange, isAutomodSecurityPutBody, type AutomodGet, type AutomodPutBody, type AutomodRuleRow } from "../../../../../src/lib/automod.ts";
import { MAX_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS } from "../../../../../src/lib/constants.ts";
import { stmt } from "../../../../../src/bot/db/statements.ts";
import { recordDashboardDiff } from "../../../../../src/lib/dashboard-audit.ts";

const thresholdLabels: Record<string, string> = {
  messages: "Сообщений", repeatCount: "Повторов", minimumCharacters: "Минимум букв",
  uppercasePercentage: "Заглавных %", maxEmojiCount: "Эмодзи", maxMentions: "Упоминаний",
  mode: "Режим", media: "Тип медиа", channels: "Каналы", durationSeconds: "Тайм-аут, с",
};
const modeValueLabels: Record<string, string> = {
  block_all: "блокировать все ссылки", block_domains: "блокировать список доменов",
  allow_only: "разрешить только список доменов", block: "блокировать приглашения",
  any: "фото и видео", photo: "только фото", video: "только видео",
};
function thresholdDisplay(threshold: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(threshold).filter(([key]) => thresholdLabels[key]).map(([key, value]) => [
    thresholdLabels[key]!,
    key === "channels" && Array.isArray(value) ? value.map(id => `<#${String(id)}>`) : typeof value === "string" ? (modeValueLabels[value] ?? value) : value,
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
const securityUpsert=db.prepare("INSERT INTO guild_security_settings(guild_id,ignored_role_ids_json,protected_channel_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET ignored_role_ids_json=excluded.ignored_role_ids_json,protected_channel_id=excluded.protected_channel_id,updated_at=excluded.updated_at");
// Statements готовятся один раз на модуль: SQL статический, параметры через `?`.
const rulesAllStmt=db.prepare("SELECT * FROM automod_rules WHERE guild_id=?");
const ruleGetStmt=db.prepare("SELECT enabled,action_json,threshold_json,window_seconds,escalation FROM automod_rules WHERE guild_id=? AND kind=?");
const ruleUpsertStmt=db.prepare("INSERT INTO automod_rules(guild_id,kind,enabled,action_json,threshold_json,window_seconds,escalation,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(guild_id,kind) DO UPDATE SET enabled=excluded.enabled,action_json=excluded.action_json,threshold_json=excluded.threshold_json,window_seconds=excluded.window_seconds,escalation=excluded.escalation,updated_at=excluded.updated_at");

export const GET = guildRoute(async (_, { guildId }) => {
  const security=stmt.security.get(guildId) as {ignored_role_ids_json:string;protected_channel_id:string|null}|undefined;
  const ignoredRoleIds=safeJson<unknown>(security?.ignored_role_ids_json,[]);
  const rules=rulesAllStmt.all(guildId) as AutomodRuleRow[];
  return NextResponse.json<AutomodGet>({
    rules,
    ignoredRoleIds:isSnowflakeArray(ignoredRoleIds)?ignoredRoleIds:[],
    protectedChannelId:security?.protected_channel_id??null,
  });
});

export const PUT = guildRoute(async (request, { guildId, user }) => {
  const r=await readJson<AutomodPutBody>(request);
  if(!r||typeof r!=="object")return jsonError("Некорректный запрос.");
  // Security-исключения пишет только security-payload: сохранение одного
  // правила никогда не перетирает молча гильдейские игноры.
  if (isAutomodSecurityPutBody(r)) {
    const roles = r.ignoredRoleIds ?? [], channel = r.protectedChannelId ?? null;
    if(!isSnowflakeArray(roles)||(channel!==null&&(typeof channel!=="string"||!isSnowflake(channel))))return jsonError("Некорректные роли или канал.");
    const savedSecurity=stmt.security.get(guildId) as {ignored_role_ids_json:string;protected_channel_id:string|null}|undefined;
    const storedRoles=(()=>{const parsed=safeJson<unknown>(savedSecurity?.ignored_role_ids_json,[]);return isSnowflakeArray(parsed)?[...parsed].sort():[]})();
    const unchangedSecurity=savedSecurity ? stableJson(storedRoles)===stableJson([...roles].sort())&&(savedSecurity.protected_channel_id??null)===channel : roles.length===0&&channel===null;
    if(unchangedSecurity)return NextResponse.json({ok:true,unchanged:true});
    securityUpsert.run(guildId,JSON.stringify(roles),channel,Date.now());
    recordDashboardDiff(guildId,user,"Автомодерация","Общие исключения: ",
      {
        "Исключённые роли": storedRoles.map(id=>`<@&${id}>`),
        "Защищённый канал": savedSecurity?.protected_channel_id ? `<#${savedSecurity.protected_channel_id}>` : null,
      },
      {
        "Исключённые роли": [...roles].map(id=>`<@&${id}>`),
        "Защищённый канал": channel ? `<#${channel}>` : null,
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
    const validWindow = Number.isInteger(r.window) && r.window >= automodWindowRange.min && r.window <= automodWindowRange.max;
    const validChannels = channels === undefined || isSnowflakeArray(channels);
    if (!validKind || !validActions || !validWindow || !validChannels) {
      return jsonError("Некорректные настройки правила, ролей или канала.");
    }
  }
  if(!isValidThreshold(r.threshold))return jsonError("Некорректные числовые пороги правила.");
  if(JSON.stringify(r.threshold).length>10000)return jsonError("Слишком большой список порогов.");
  const duration=Number(r.threshold.durationSeconds??DEFAULT_TIMEOUT_SECONDS); if(!Number.isFinite(duration)||duration<1||duration>MAX_TIMEOUT_SECONDS)return jsonError("Тайм-аут может длиться от 1 секунды до 28 дней.");
  const existingRule=ruleGetStmt.get(guildId,r.kind) as {enabled:number;action_json:string;threshold_json:string;window_seconds:number;escalation:number}|undefined;
  const storedActions=safeJson<unknown>(existingRule?.action_json,[]);
  const cleanStoredActions=Array.isArray(storedActions)?storedActions.filter(x=>typeof x==="string"):[];
  const beforeThreshold=existingRule?safeJson<Record<string,unknown>>(existingRule.threshold_json,{}):{};
  if(existingRule){
    const unchangedRule=existingRule.enabled===+r.enabled&&existingRule.window_seconds===r.window&&existingRule.escalation===+r.escalation&&stableJson(cleanStoredActions)===stableJson(r.actions)&&stableJson(beforeThreshold)===stableJson(r.threshold);
    if(unchangedRule)return NextResponse.json({ok:true,unchanged:true});
  }
  ruleUpsertStmt.run(guildId,r.kind,+r.enabled,JSON.stringify(r.actions),JSON.stringify(r.threshold),r.window,+r.escalation,Date.now());
  const payload=(enabled:boolean,actions:string[],window:number,escalation:boolean,threshold:Record<string,unknown>)=>({
    "Включено":enabled, "Действия":actions, "Окно, с":window, "Эскалация":escalation, ...thresholdDisplay(threshold),
  });
  recordDashboardDiff(guildId,user,"Автомодерация",`Правило «${automodRulesM[r.kind]?.title.ru ?? r.kind}»: `,
    existingRule?payload(Boolean(existingRule.enabled),cleanStoredActions,existingRule.window_seconds,Boolean(existingRule.escalation),beforeThreshold):{},
    payload(r.enabled,r.actions,r.window,r.escalation,r.threshold));
  return NextResponse.json({ok:true});
});
