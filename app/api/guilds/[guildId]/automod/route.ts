import { NextResponse } from "next/server.js";
import { isSnowflake, withGuild } from "../../../../../src/lib/guild-access.ts";
import { db } from "../../../../../src/db/database.ts";
import { safeJson, stableJson } from "../../../../../src/lib/json.ts";
import { automodRulesM } from "../../../../../src/lib/labels.ts";
import { automodActions } from "../../../../../src/lib/automod.ts";
import { MAX_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS } from "../../../../../src/lib/constants.ts";
import { stmt } from "../../../../../src/bot/db/statements.ts";
import { recordDashboardChange } from "../../../../../src/lib/dashboard-audit.ts";

const kinds: readonly string[] = Object.keys(automodRulesM);
type Payload={kind:string;enabled:boolean;actions:string[];threshold:Record<string,unknown>;window:number;escalation:boolean;ignoredRoleIds?:string[];protectedChannelId?:string|null};
const isSnowflakeArray=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(x=>typeof x==="string"&&isSnowflake(x));
const securityUpsert=db.prepare("INSERT INTO guild_security_settings(guild_id,ignored_role_ids_json,protected_channel_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET ignored_role_ids_json=excluded.ignored_role_ids_json,protected_channel_id=excluded.protected_channel_id,updated_at=excluded.updated_at");

export async function GET(_:Request,{params}:{params:Promise<{guildId:string}>}) { const {guildId}=await params, access=await withGuild(guildId); if(access instanceof Response)return access; const security=stmt.security.get(guildId) as {ignored_role_ids_json:string;protected_channel_id:string|null}|undefined; const ignoredRoleIds=safeJson<unknown>(security?.ignored_role_ids_json,[]); return NextResponse.json({rules:db.prepare("SELECT * FROM automod_rules WHERE guild_id=?").all(guildId),ignoredRoleIds:isSnowflakeArray(ignoredRoleIds)?ignoredRoleIds:[],protectedChannelId:security?.protected_channel_id??null}); }

export async function PUT(request:Request,{params}:{params:Promise<{guildId:string}>}) { const {guildId}=await params, access=await withGuild(guildId); if(access instanceof Response)return access; let r:Payload; try { r=await request.json() as Payload; } catch { return NextResponse.json({error:"Некорректный запрос."},{status:400}); } const roles=r.ignoredRoleIds??[], channel=r.protectedChannelId??null, channels=r.threshold?.channels, domains=r.threshold?.domains;
  if(!isSnowflakeArray(roles)||(channel!==null&&(typeof channel!=="string"||!isSnowflake(channel))))return NextResponse.json({error:"Некорректные роли или канал."},{status:400});
  if(r.kind!=="security"&&(typeof r.enabled!=="boolean"||typeof r.escalation!=="boolean"))return NextResponse.json({error:"Некорректное состояние правила."},{status:400});
  if(domains!==undefined&&(!Array.isArray(domains)||domains.some(x=>typeof x!=="string"||!x.length||x.length>253)))return NextResponse.json({error:"Некорректный список доменов."},{status:400});
  if(r.kind!=="security"&&(!kinds.includes(r.kind)||!Array.isArray(r.actions)||!r.actions.every(x=>automodActions.includes(x))||!r.actions.length||!Number.isInteger(r.window)||r.window<1||r.window>3600||typeof r.threshold!=="object"||Array.isArray(r.threshold)||!r.threshold||(channels!==undefined&&!isSnowflakeArray(channels))))return NextResponse.json({error:"Некорректные настройки правила, ролей или канала."},{status:400});
  if(r.kind!=="security"&&JSON.stringify(r.threshold).length>10000)return NextResponse.json({error:"Слишком большой список порогов."},{status:400});
  const duration=Number(r.threshold?.durationSeconds??DEFAULT_TIMEOUT_SECONDS); if(r.kind!=="security"&&(!Number.isFinite(duration)||duration<1||duration>MAX_TIMEOUT_SECONDS))return NextResponse.json({error:"Тайм-аут может длиться от 1 секунды до 28 дней."},{status:400});
  // Security-исключения пишет только security-payload: сохранение одного
  // правила никогда не перетирает молча гильдейские игноры.
  if(r.kind==="security"){
    const savedSecurity=stmt.security.get(guildId) as {ignored_role_ids_json:string;protected_channel_id:string|null}|undefined;
    const storedRoles=(()=>{const parsed=safeJson<unknown>(savedSecurity?.ignored_role_ids_json,[]);return isSnowflakeArray(parsed)?[...parsed].sort():[]})();
    const unchangedSecurity=savedSecurity ? stableJson(storedRoles)===stableJson([...roles].sort())&&(savedSecurity.protected_channel_id??null)===channel : roles.length===0&&channel===null;
    if(unchangedSecurity)return NextResponse.json({ok:true,unchanged:true});
    securityUpsert.run(guildId,JSON.stringify(roles),channel,Date.now());recordDashboardChange(guildId,access.user,"Автомодерация",`Общие исключения: ${roles.length ? `${roles.length} ролей` : "нет"}${channel ? ", защищённый канал выбран" : ""}`);return NextResponse.json({ok:true});}
  const existingRule=db.prepare("SELECT enabled,action_json,threshold_json,window_seconds,escalation FROM automod_rules WHERE guild_id=? AND kind=?").get(guildId,r.kind) as {enabled:number;action_json:string;threshold_json:string;window_seconds:number;escalation:number}|undefined;
  if(existingRule){
    const storedActions=safeJson<unknown>(existingRule.action_json,[]);
    const unchangedRule=existingRule.enabled===+r.enabled&&existingRule.window_seconds===r.window&&existingRule.escalation===+r.escalation&&stableJson(Array.isArray(storedActions)?storedActions.filter(x=>typeof x==="string"):[])===stableJson(r.actions)&&stableJson(safeJson<unknown>(existingRule.threshold_json,null))===stableJson(r.threshold);
    if(unchangedRule)return NextResponse.json({ok:true,unchanged:true});
  }
  db.prepare("INSERT INTO automod_rules(guild_id,kind,enabled,action_json,threshold_json,window_seconds,escalation,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(guild_id,kind) DO UPDATE SET enabled=excluded.enabled,action_json=excluded.action_json,threshold_json=excluded.threshold_json,window_seconds=excluded.window_seconds,escalation=excluded.escalation,updated_at=excluded.updated_at").run(guildId,r.kind,+r.enabled,JSON.stringify(r.actions),JSON.stringify(r.threshold),r.window,+r.escalation,Date.now());
  recordDashboardChange(guildId,access.user,"Автомодерация",`Правило «${automodRulesM[r.kind]?.title.ru ?? r.kind}» ${r.enabled ? "включено" : "выключено"} · действия: ${r.actions.join(", ")}`);
  return NextResponse.json({ok:true});
}
