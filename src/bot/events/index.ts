import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, MessageFlags, type Client, type Interaction } from "discord.js";
import { applyEventRole, claimReminder, detachEventMessage, dueReminders, eventCounts, eventParticipants, getEvent, getEventInGuild, joinEvent, leaveEvent, parseEventButtons, parseEventEmbed, removeParticipantFromGuild, renderEventButtons, renderEventEmbed, renderableOf, sendReminderDm, transitionDueEvents, updateEventMessage, type EventButton, type EventEmbedPayload, type EventRow } from "../../lib/events.ts";
import { resolveChannel } from "../logging/index.ts";
import { logger } from "../utils/logger.ts";
import { guard, isMissingDiscordResource } from "../../lib/errors.ts";
import { count } from "../perf.ts";
import { buttonStyleId } from "../../lib/constants.ts";
import { eventUploadPrefix, eventUploadsDir } from "../../lib/uploads.ts";
import { reattachStoredAssets } from "../../lib/assets.ts";
import { eventsTr, guildLang, guildTr } from "../../lib/i18n/bot.ts";

const toDiscordButtonStyle = (name: EventButton["style"]): ButtonStyle => buttonStyleId(name) as ButtonStyle;

async function attachLocalImages(guildId: string, embed: EventEmbedPayload) {
  const setAsset = (target: "thumbnail" | "image", url: string) => { if (target === "thumbnail") embed.thumbnail = { url }; else embed.image = { url }; };
  const { assets } = await reattachStoredAssets<"thumbnail" | "image">({
    targets: ["thumbnail", "image"],
    urlOf: target => target === "thumbnail" ? embed.thumbnail?.url : embed.image?.url,
    skipTargets: [],
    prefix: eventUploadPrefix(guildId),
    dir: eventUploadsDir(guildId),
    setAsset,
    optional: true,
  });
  return assets.map(asset => ({ attachment: asset.bytes, name: asset.filename }));
}

export function registerEvents(client: Client) {
  client.on(Events.InteractionCreate, (i) => guard("EVENTS", () => handleInteraction(i)));
  client.on(Events.MessageDelete, (message) => { if (message.guildId) detachEventMessage(message.id); });
  client.on(Events.GuildMemberRemove, (member) => {
    for (const result of removeParticipantFromGuild(member.guild.id, member.user.id)) {
      const event = getEvent(result.eventId);
      if (event?.event_role_id) {
        void applyEventRole(member.guild.id, member.user.id, event.event_role_id, false);
        if (result.promotedUserId) void applyEventRole(member.guild.id, result.promotedUserId, event.event_role_id, true);
      }
      void refreshMessage(member.guild.id, result.eventId);
    }
  });
  setInterval(() => void tick(), 30_000).unref();
}

async function handleInteraction(i: Interaction) {
  if (!i.isButton()) return;
  const [, key, eventId] = i.customId.split(":");
  if ((key !== "join" && key !== "leave") || !eventId) return;
  count(`events.${key}`);
  const event = getEventInGuild(i.guildId ?? "", eventId);
  const tr = guildTr(eventsTr, event?.guild_id ?? i.guildId ?? "");
  if (!event) return i.reply({ content: tr("notFound"), flags: MessageFlags.Ephemeral }).catch(() => null);
  const result = key === "join" ? joinEvent(eventId, i.user.id, event.guild_id) : leaveEvent(eventId, i.user.id, event.guild_id);
  if (!result.ok) return i.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral }).catch(() => null);
  if (key === "join") {
    // Отвечаем сразу: применение роли — REST-вызов, который на медленном
    // соединении превысил бы 3-секундное окно interaction и дал «Interaction failed».
    await i.reply({ content: result.action === "waitlisted" ? tr("waitlisted") : result.action === "already_joined" ? tr("alreadyJoined") : tr("joined"), flags: MessageFlags.Ephemeral }).catch(() => null);
    await applyEventRole(event.guild_id, i.user.id, event.event_role_id, true);
  } else {
    const promotedUserId = "promotedUserId" in result ? result.promotedUserId : null;
    await i.reply({ content: result.action === "not_registered" ? tr("notRegistered") : result.action === "left_waitlist" ? tr("leftWaitlist") : "promotedUserId" in result && result.promotedUserId ? tr("leftPromoted") : tr("left"), flags: MessageFlags.Ephemeral }).catch(() => null);
    await applyEventRole(event.guild_id, i.user.id, event.event_role_id, false);
    if (promotedUserId) await applyEventRole(event.guild_id, promotedUserId, event.event_role_id, true);
  }
  void refreshMessage(event.guild_id, event.id);
}

const queues = new Map<string, Promise<void>>();
const pendingRefresh = new Set<string>();
function refreshMessage(guildId: string, eventId: string): Promise<void> {
  const running = queues.get(eventId);
  if (running) { pendingRefresh.add(eventId); return running; }
  const run = refreshMessageNow(guildId, eventId).catch((error: unknown) => {
    logger.warn("[EVENTS] Не удалось обновить сообщение события", guildId, eventId, error);
  }).finally(() => {
    if (queues.get(eventId) === run) queues.delete(eventId);
    if (pendingRefresh.delete(eventId)) refreshMessage(guildId, eventId);
  });
  queues.set(eventId, run);
  return run;
}

async function buildEventMessage(event: EventRow): Promise<{ embed: EventEmbedPayload; components: ActionRowBuilder<ButtonBuilder>[]; files: { attachment: Buffer; name: string }[] }> {
  const counts = eventCounts(event.id);
  const embed = renderEventEmbed(guildLang(event.guild_id), renderableOf(event), parseEventEmbed(event.embed_json), counts);
  const files = await attachLocalImages(event.guild_id, embed);
  const buttons = renderEventButtons(renderableOf(event), parseEventButtons(event.buttons_json), counts);
  const components = buttons.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.map(b => {
    const built = new ButtonBuilder().setCustomId(`event:${b.key}:${event.id}`).setLabel(b.label).setStyle(toDiscordButtonStyle(b.style)).setDisabled(b.disabled);
    if (b.emoji) built.setEmoji(b.emoji);
    return built;
  }))] : [];
  return { embed, components, files };
}

async function refreshMessageNow(guildId: string, eventId: string) {
  const event = getEventInGuild(guildId, eventId);
  if (!event?.message_id) return;
  // Недоступный канал (негативный кэш, старт) НЕ отвязывает ссылку: следующее
  // обновление повторит правку. Отвязка — только на реальный 404.
  const channel = await resolveChannel(event.channel_id);
  if (!channel) return;
  const { embed, components, files } = await buildEventMessage(event);
  try {
    // PATCH напрямую по id: fetch полного сообщения перед edit — лишний GET
    // на каждое нажатие кнопки (MessageManager.edit принимает snowflake).
    await channel.messages.edit(event.message_id, { embeds: [embed], components, files });
  } catch (error) {
    if (isMissingDiscordResource(error)) detachEventMessage(event.message_id);
  }
}

const REMINDER_CONCURRENCY = 5;
// Напоминания не держат глобальный ticking: DM-рассылка вынесена из цикла и
// идёт ограниченными пачками (один зависший fetch не блокирует переходы событий).
async function sendReminders(event: EventRow): Promise<void> {
  const participants = eventParticipants(event.id);
  for (let i = 0; i < participants.length; i += REMINDER_CONCURRENCY) {
    await Promise.allSettled(participants.slice(i, i + REMINDER_CONCURRENCY).map(p => sendReminderDm(p.user_id, event)));
  }
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const reminder of dueReminders(now)) {
      if (!claimReminder(reminder.id, now)) continue;
      const event = getEvent(reminder.event_id);
      // Статус-гейт: после простоя напоминания по уже начавшемуся/завершённому
      // событию ушли бы как «начнётся через…» с датой в прошлом.
      if (!event || event.status !== "scheduled") continue;
      void sendReminders(event);
    }
    const { changed, created } = transitionDueEvents(now);
    for (const follower of created) await publishEventMessage(follower);
    for (const event of changed) void refreshMessage(event.guild_id, event.id);
  } catch (error) {
    logger.error("[EVENTS] Ошибка в цикле событий:", error);
  } finally {
    ticking = false;
  }
}

async function publishEventMessage(event: EventRow) {
  const channel = await resolveChannel(event.channel_id);
  if (!channel) { logger.warn("[EVENTS] Канал недоступен, сообщение следующего повторения не опубликовано:", event.channel_id); return; }
  const { embed, components, files } = await buildEventMessage(event);
  try {
    const message = await channel.send({ embeds: [embed], components, files });
    updateEventMessage(event.id, message.id);
  } catch (error) {
    logger.warn("[EVENTS] Не удалось опубликовать сообщение следующего повторения:", error);
  }
}