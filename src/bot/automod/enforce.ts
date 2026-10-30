import { ChannelType, type Client, type Guild, type Message } from "discord.js";
import { stmt } from "../../db/statements.ts";
import { safeJson } from "../../lib/json.ts";
import { automodActions, automodDefaultActions } from "../../lib/automod.ts";
import { automodRulesFor } from "../../lib/labels.ts";
import { DAY_MS, DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS } from "../../lib/constants.ts";
import { burstMessages, clearWarned, isBurstKind, markWarned, shouldWarn, type MessageData, type Rule } from "./detectors.ts";
import { offerAppeal } from "../appeals/index.ts";
import { addMetric } from "../metrics.ts";
import { logAction, markBotAction } from "../logging/index.ts";
import { cachedRules, type CachedRule } from "../config-cache.ts";
import { logger } from "../../lib/logger.ts";
import { automodTr, trFor } from "../../lib/i18n/bot.ts";
import { logTr } from "../../lib/i18n/bot/logs.ts";
import { time } from "../../lib/perf.ts";

const automodRuleTitles = { ru: automodRulesFor("ru"), en: automodRulesFor("en") } as const;
const automodActionSet = new Set<string>(automodActions);

function automodDuration(guildId: string, userId: string, base: number, escalate: boolean) {
  if (!escalate) return base;
  const recent = stmt.automodRecent.get(guildId, userId, Date.now() - DAY_MS)!;
  return Math.min(MAX_TIMEOUT_SECONDS, base * 2 ** Math.min(4, recent.count));
}

export async function enforceAutoMod(client: Client, message: Message, row: CachedRule, threshold: Record<string, unknown>, data: MessageData) {
  const started = performance.now();
  const guild = message.guild!, author = message.author;
  let actions: string[] = []; const parsedActions = safeJson<unknown>(row.action_json, []); if (Array.isArray(parsedActions)) actions = parsedActions.filter((x): x is string => typeof x === "string" && automodActionSet.has(x));
  if (!actions.length) actions = [...automodDefaultActions];
  const lang = cachedRules(guild.id).lang;
  const t = trFor(logTr, lang), tAuto = trFor(automodTr, lang);
  const ruleName = automodRuleTitles[lang][row.kind]?.title ?? row.kind, reason = tAuto("reason", { rule: ruleName });
  const rule: Rule = { kind: row.kind, threshold, window: row.window_seconds };
  const burstKind = isBurstKind(row.kind);
  // Окно наказания захватывается СИНХРОННО, до первого await: иначе следующее
  // сообщение того же пользователя успевало бы пройти проверку и получить
  // второе наказание за то же окно.
  const firstInBurst = burstKind ? shouldWarn(rule, data) : true;
  if (burstKind && firstInBurst) markWarned(rule, data);
  // Сообщение в уже обработанном burst-окне: удаляем, но не выдаём наказание
  // повторно (timeout/kick/ban/warn — один раз на окно).
  const repeatBurst = burstKind && !firstInBurst;
  let burst: { id: string; channelId: string }[] = [];
  let deletedCount = 0;
  const applied: string[] = [];
  if (actions.includes("delete")) {
    burst = burstKind ? burstMessages(rule, data) : [];
    deletedCount = burst.length ? await deleteBurst(guild, burst) : await message.delete().then(() => 1, () => 0);
    if (deletedCount > 0) applied.push("delete");
  }
  const member = message.member;
  if (actions.includes("timeout") && member?.moderatable && !repeatBurst) {
    markBotAction(guild.id, "member_timeout", author.id);
    const base = Math.max(1, Math.min(MAX_TIMEOUT_SECONDS, Number(threshold.durationSeconds ?? DEFAULT_TIMEOUT_SECONDS)));
    if (await member.timeout(automodDuration(guild.id, author.id, base, Boolean(row.escalation)) * 1000, reason).then(() => true, () => false)) applied.push("timeout");
  }
  if (actions.includes("kick") && member?.kickable && !repeatBurst) { markBotAction(guild.id, "member_kick", author.id); if (await member.kick(reason).then(() => true, () => false)) applied.push("kick"); }
  if (actions.includes("ban") && member?.bannable && !repeatBurst) { markBotAction(guild.id, "member_ban", author.id); if (await member.ban({ reason }).then(() => true, () => false)) applied.push("ban"); }
  // Предупреждение видно в /warnings: строка type='warn', как у ручного /warn.
  let warnPunishmentId: number | null = null;
  if (actions.includes("warn") && !repeatBurst) {
    try {
      warnPunishmentId = Number(stmt.moderationInsert.run(guild.id, author.id, "automod", "warn", reason, Date.now()).lastInsertRowid);
      addMetric(guild.id, "moderation");
      applied.push("warn");
    } catch (error) { logger.warn("Не удалось записать предупреждение автомодерации", guild.id, error); }
  }
  // Строка type='automod' — для наказаний (timeout/kick/ban). Апелляция
  // предлагается при warn/timeout/ban: warn использует строку из /warnings,
  // kick необратим, delete — не наказание. Конкретное действие передаётся в
  // апелляцию (appealType), иначе reversalFor('automod') не снял бы ничего.
  let punishmentId: number | null = null;
  if (applied.some(action => action === "timeout" || action === "kick" || action === "ban")) {
    try {
      punishmentId = Number(stmt.moderationInsert.run(guild.id, author.id, null, "automod", row.kind, Date.now()).lastInsertRowid);
      addMetric(guild.id, "moderation");
    } catch (error) { logger.warn("Не удалось записать действие автомодерации", guild.id, error); }
  } else if (!applied.length) {
    logger.warn("[AUTOMOD] Ни одна мера не применилась", guild.id, row.kind, author.id, actions.join(","));
  }
  const banApplied = applied.includes("ban"), timeoutApplied = applied.includes("timeout");
  const appealType = banApplied ? "ban" : timeoutApplied ? "timeout" : applied.includes("warn") && warnPunishmentId !== null ? "warn" : null;
  if (appealType && (!burstKind || firstInBurst)) {
    const appealTarget = appealType === "warn" ? warnPunishmentId : punishmentId;
    if (appealTarget !== null) void offerAppeal(client, { punishmentId: appealTarget, guildId: guild.id, guildName: guild.name, userId: author.id, type: "automod", appealType, reason });
  }
  // Наказание не применилось (только delete или отказ Discord) — снимаем
  // claim окна, иначе следующее сообщение в окне уже не получит наказания.
  const punished = banApplied || timeoutApplied || applied.includes("kick") || applied.includes("warn");
  if (burstKind && !punished) clearWarned(rule, data);
  logAction({ guildId: guild.id, type: "automod", targetId: author.id, moderatorId: "automod", details: `${t("reason", { reason: ruleName })}\n${applied.length ? t("actionsLine", { list: applied.join(", ") }) : t("actionsFailedLine")}${deletedCount > 0 ? t("deletedFromBurst", { n: String(deletedCount) }) : ""}` });
  time("automod.enforce", performance.now() - started);
}

async function deleteBurst(guild: Guild, burst: { id: string; channelId: string }[]): Promise<number> {
  let deleted = 0;
  for (const [channelId, entries] of Map.groupBy(burst, entry => entry.channelId)) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement && !channel.isThread())) continue;
    const removed = await channel.bulkDelete(entries.map(entry => entry.id), true).catch(() => null);
    deleted += removed?.size ?? 0;
  }
  return deleted;
}
