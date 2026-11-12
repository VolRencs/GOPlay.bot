import type { GuildMember, MessageReaction, PartialMessageReaction, PartialUser, User } from "discord.js";
import { setTimeout as delay } from "node:timers/promises";
import { normalizeEmojiText, sameEmojiValue } from "goemoji/discord";
import { count } from "../lib/perf.ts";
import { cachedPanel, reactionPanel } from "./config-cache.ts";
import { fetchMember } from "./utils/members.ts";
import { automodTr, guildLang } from "../lib/i18n/bot.ts";

const roleLocks = new Map<string, Promise<void>>();
const ROLE_LOCK_TIMEOUT_MS = 10_000;
const lockTimeout = () => delay(ROLE_LOCK_TIMEOUT_MS, undefined, { ref: false }).then<never>(() => { throw new Error("role lock timeout"); });
async function withRoleLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = roleLocks.get(key) ?? Promise.resolve();
  const { promise: cur, resolve: release } = Promise.withResolvers<void>();
  roleLocks.set(key, cur);
  await Promise.race([prev, lockTimeout()]).catch(() => null);
  try {
    return await fn();
  } finally {
    release();
    if (roleLocks.get(key) === cur) roleLocks.delete(key);
  }
}

async function applyPanelRole(guildId: string, panelId: number, roleId: string, member: GuildMember) {
  return withRoleLock(`${guildId}:${member.id}`, async () => {
    // Re-read the member inside the lock: role mutations return clones and do not update this snapshot.
    const fresh = await fetchMember(member.guild, member.id) ?? member;
    const panel = cachedPanel(guildId, panelId);
    const role = fresh.guild.roles.cache.get(roleId);
    if (!panel || !role || role.managed || !role.editable) return { text: automodTr(guildLang(guildId), "roleUnavailable"), notify: true };
    const options = panel.options;
    if (!options.some(option => option.role_id === roleId)) return { text: automodTr(guildLang(guildId), "roleUnavailable"), notify: true };
    const has = fresh.roles.cache.has(roleId);
    const action = panel.role_mode === "add" ? "add" : panel.role_mode === "remove" ? "remove" : has ? "remove" : "add";
    if (action === "add" && !has && panel.role_limit > 0) {
      if (options.map(x => x.role_id).filter(id => fresh.roles.cache.has(id)).length >= panel.role_limit) return { text: automodTr(guildLang(guildId), "roleLimitReached", { n: String(panel.role_limit) }), notify: true };
    }
    await fresh.roles[action](role);
    return { text: panel.notify_template.replaceAll("{role}", () => role.name), notify: Boolean(panel.notify_enabled) };
  });
}

export function applyPanelRoleSafe(guildId: string, panelId: number, roleId: string, member: GuildMember): Promise<{ text: string; notify: boolean }> {
  return applyPanelRole(guildId, panelId, roleId, member).catch(() => ({ text: automodTr(guildLang(guildId), "roleUpdateFail"), notify: true }));
}

export function panelNotifies(guildId: string, panelId: number): boolean {
  return Boolean(cachedPanel(guildId, panelId)?.notify_enabled);
}

function samePanelEmoji(saved: string | null, name: string | null, identifier: string) { if (!saved) return normalizeEmojiText(name ?? "") === normalizeEmojiText("✅"); return sameEmojiValue(saved, name, identifier); }

export async function handleReaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, removing: boolean) {
  count("events.reaction");
  const author = user.partial ? await user.fetch().catch(() => null) : user;
  if (!author || author.bot) return;
  const guildId = reaction.message.guildId;
  if (!guildId) return;
  const panel = reactionPanel(guildId, reaction.message.id);
  if (!panel) return;
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message?.guild) return;
  const option = panel.options.find(o => samePanelEmoji(o.emoji, reaction.emoji.name, reaction.emoji.identifier));
  if (!option || (removing && panel.role_mode === "add")) return;
  const member = await fetchMember(message.guild, author.id);
  if (!member) return;
  if (removing) {
    const fresh = await fetchMember(member.guild, member.id) ?? member;
    const role = fresh.guild.roles.cache.get(option.role_id);
    if (role?.editable && fresh.roles.cache.has(role.id)) await fresh.roles.remove(role).catch(() => null);
    return;
  }
  const result = await applyPanelRoleSafe(message.guild.id, panel.id, option.role_id, member);
  if (result.notify) await member.send(result.text).catch(() => null);
}
