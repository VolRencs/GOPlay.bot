import { automodThresholdDefaults, type RuleKind } from "../../lib/automod.ts";
export type MessageData = { id: string; guildId: string; userId: string; channelId: string; content: string; roleIds: string[]; mentionCount: number; everyone: boolean; attachments: { contentType: string | null }[]; at: number };
export type Rule = { kind: RuleKind; threshold: Record<string, unknown>; window: number };
type Timed = { at: number; text: string; amount: number; id: string; channelId: string };
const memory = new Map<string, Timed[]>();
const warned = new Map<string, number>();
function keyFor(rule: Rule, message: MessageData) { return `${message.guildId}:${rule.kind}:${message.userId}`; }
function bucket(key: string, at: number, window: number) { const values = (memory.get(key) ?? []).filter((x) => x.at >= at - window * 1000); memory.set(key, values); return values; }
const URL_RE = /(?:https?:\/\/|www\.)[^\s<]+/gi;
const DOMAIN_RE = /(?:^|[\s(])([a-zа-яё][\wа-яё-]*(\.[a-zа-яё][\wа-яё-]*)+)/gi;
const EMOJI_RE = /<a?:\w+:\d+>|\p{Extended_Pictographic}/gu;
function urls(text: string) { return text.match(URL_RE) ?? []; }
function bareDomains(text: string) { const out: string[] = []; for (const match of text.matchAll(DOMAIN_RE)) { try { out.push(new URL(`https://${match[1]}`).hostname.toLowerCase()); } catch { /* ignore malformed token */ } } return out; }
export function detect(rule: Rule, message: MessageData): boolean {
  const t = rule.threshold; const key = keyFor(rule, message);
  if (rule.kind === "spam") { const a = bucket(key,message.at,rule.window); a.push({at:message.at,text:"",amount:1,id:message.id,channelId:message.channelId}); return a.length >= Number(t.messages ?? automodThresholdDefaults.spam.messages); }
  if (rule.kind === "duplicate") { const a=bucket(key,message.at,rule.window); const text=message.content.trim().toLowerCase(); a.push({at:message.at,text,amount:1,id:message.id,channelId:message.channelId}); return a.filter(x=>x.text===text).length >= Number(t.repeatCount ?? automodThresholdDefaults.duplicate.repeatCount); }
  if (rule.kind === "caps") { const letters=[...message.content].filter(c=>/\p{L}/u.test(c)); const upper=letters.filter(c=>c===c.toUpperCase()).length; return letters.length >= Number(t.minimumCharacters ?? automodThresholdDefaults.caps.minimumCharacters) && upper / letters.length * 100 >= Number(t.uppercasePercentage ?? automodThresholdDefaults.caps.uppercasePercentage); }
  if (rule.kind === "emoji") { const count=(message.content.match(EMOJI_RE) ?? []).length; if(count<=3)return false; const a=bucket(key,message.at,rule.window); a.push({at:message.at,text:"",amount:count,id:message.id,channelId:message.channelId}); return a.reduce((n,x)=>n+x.amount,0)>Number(t.maxEmojiCount ?? automodThresholdDefaults.emoji.maxEmojiCount); }
  if (rule.kind === "mentions") return message.everyone || message.mentionCount > Number(t.maxMentions ?? automodThresholdDefaults.mentions.maxMentions);
  if (rule.kind === "links") { const mode=String(t.mode ?? automodThresholdDefaults.links.mode), list=Array.isArray(t.domains)?t.domains.map(String):[], channels=Array.isArray(t.channels)?t.channels.map(String):[]; if(channels.length&&!channels.includes(message.channelId))return false; const found=[...urls(message.content).map(x=>{try{return new URL(x.startsWith("www.")?`https://${x}`:x).hostname.toLowerCase()}catch{return ""}}),...(mode!=="block_all"?bareDomains(message.content):[])].filter(Boolean); return found.some(host=>mode==="block_all" || (mode==="allowlist"&&!list.includes(host)) || (mode==="blocklist"&&list.includes(host))); }
  if (rule.kind === "links_only") { const channels=Array.isArray(t.channels)?t.channels.map(String):[]; return (!channels.length||channels.includes(message.channelId)) && urls(message.content).length===0; }
  if (rule.kind === "media_only") { const channels=Array.isArray(t.channels)?t.channels.map(String):[]; const media=String(t.media??"any"); const allowed=message.attachments.some(a=>media==="any"?/^(image|video)\//.test(a.contentType??""):a.contentType?.startsWith(`${media}/`)); return (!channels.length||channels.includes(message.channelId))&&!allowed; }
  const invite=/discord(?:\.gg|(?:app)?\.com\/invite)\/[a-z0-9-]+/i.test(message.content); return invite && t.mode !== "allow";
}
export function isIgnored(message: MessageData, ignoredRoleIds: string[]): boolean { return message.roleIds.some(id => ignoredRoleIds.includes(id)); }
export function burstMessages(rule: Rule, message: MessageData): { id: string; channelId: string }[] {
  const values = bucket(keyFor(rule, message), message.at, rule.window);
  const filtered = rule.kind === "duplicate" ? values.filter(x => x.text === message.content.trim().toLowerCase()) : values;
  return filtered.map(x => ({ id: x.id, channelId: x.channelId }));
}
export function shouldWarn(rule: Rule, message: MessageData): boolean {
  const last = warned.get(keyFor(rule, message));
  return last === undefined || last < message.at - rule.window * 1000;
}
export function markWarned(rule: Rule, message: MessageData) { warned.set(keyFor(rule, message), message.at); }
export function resetDetectors() { memory.clear(); warned.clear(); }
export function pruneDetectors() {
  // Окно правила настраивается до 3600 c: запас +1 минута, иначе редкая серия
  // внутри длинного окна теряла бы счёт (и warned сбрасывался бы слишком рано).
  const cutoff = Date.now() - 61 * 60_000;
  for (const [key, values] of memory) {
    const last = values[values.length - 1];
    if (!values.length || !last || last.at < cutoff) memory.delete(key);
  }
  for (const [key, at] of warned) if (at < cutoff) warned.delete(key);
}
