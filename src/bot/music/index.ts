import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, type ButtonInteraction, type Client, type Interaction, type StringSelectMenuInteraction } from "discord.js";
import { count } from "../../lib/perf.ts";
import { logger } from "../../lib/logger.ts";
import { stmt } from "../../db/statements.ts";
import { failInteraction, guard, isMissingDiscordResource } from "../../lib/errors.ts";
import { guildLang } from "../../lib/i18n/bot.ts";
import { SELECT_OPTION_LIMIT } from "../../lib/limits.ts";
import { resolveChannel } from "../logging/index.ts";
import { musicSettingsFor } from "../../lib/music-settings.ts";
import { queueView, renderMusicPanel, trackLabel } from "./panel.ts";
import { isAdminInteraction, musicTFor } from "./shared.ts";
import {
  cycleLoop, getSessionTextChannelId, getQueueSnapshot,
  moveToVoice, moveQueueTrack, pickFollowTarget, playbackStateOf,
  refreshSessionActivity, removeQueueTracks, setOnMusicChange, setOnTrackStart,
  setPlayerEnvironment, shuffleQueue, skipCurrent, stopAndLeave, togglePause,
  type Track,
} from "../../lib/player/index.ts";

export { handleMusicCommand } from "./command.ts";
/** Debounce перерисовки: серия notify (плейлист = десяток изменений за раз)
 *  даёт ОДНУ правку сообщения через 500 мс — один edit вместо ~50 fetch+edit
 *  и риска упереться в rate limit прямо во время /play. */
const PANEL_DEBOUNCE_MS = 500;
const PANEL_PROGRESS_MS = 20_000;
const PENDING_MOVE_TTL_MS = 5 * 60_000;

let registered = false;
/** Регистрация обработчиков. Вызывается один раз из src/bot/index.ts. */
export function registerMusic(client: Client): void {
  if (registered) return;
  registered = true;
  setOnMusicChange(refreshPanel);
  // Прогресс-бар обновляем редко: панель живёт без риска rate limit.
  setInterval(() => {
    for (const guildId of panels.keys()) {
      const state = playbackStateOf(guildId);
      if (state && !state.paused) refreshPanel(guildId);
    }
  }, PANEL_PROGRESS_MS).unref();
  setInterval(() => {
    const now = Date.now();
    for (const [key, pending] of pendingMoves) if (now - pending.at > PENDING_MOVE_TTL_MS) pendingMoves.delete(key);
  }, 60_000).unref();
  // Данные присутствия для таймера бездействия: сколько людей в канале, где
  // стоит бот. Только gateway-кэш — без REST на голосовых событиях.
  setPlayerEnvironment({
    humansInBotChannel: guildId => {
      const guild = client.guilds.cache.get(guildId);
      const channelId = guild?.members.me?.voice.channelId;
      const channel = channelId ? guild!.channels.cache.get(channelId) : null;
      return channel?.isVoiceBased() ? channel.members.filter(m => !m.user.bot).size : 0;
    },
  });
  // Новый трек: автор в другом разрешённом канале — переезжаем к нему.
  // Нельзя (вышел, нет прав, канал не в whitelist) — молча играем где стоим.
  setOnTrackStart((guildId, requestedBy) => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const requesterVc = guild.members.cache.get(requestedBy)?.voice.channelId ?? null;
    const target = pickFollowTarget(guild.members.me?.voice.channelId ?? null, requesterVc, musicSettingsFor(guildId).voice_channel_ids);
    if (!target) return;
    // Права и тип проверяем по кэшу; нет данных — остаёмся на месте.
    const channel = guild.channels.cache.get(target);
    const perms = channel?.permissionsFor(guild.members.me ?? guild.roles.everyone);
    if (!channel?.isVoiceBased() || !perms?.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak)) {
      logger.info("[MUSIC] Не переехал к автору: канал недоступен или нет прав", guildId, target);
      return;
    }
    moveToVoice(guildId, target);
  });
  // Голосовые события: пересчёт единого таймера бездействия (пусто/тишина/пауза
  // решает сама сессия). Свои переходы бота событиями не считаем — иначе первый
  // же rejoin из пустеющего канала убил бы живую сессию.
  client.on(Events.VoiceStateUpdate, (oldState, newState) => guard("MUSIC_VOICE", () => {
    if (oldState.id === client.user!.id) {
      if (oldState.channelId !== newState.channelId) refreshSessionActivity(newState.guild.id);
      return;
    }
    const guildId = newState.guild.id;
    if (!getSessionTextChannelId(guildId)) return;
    if (oldState.channelId === newState.channelId) return;
    refreshSessionActivity(guildId);
  }));
  client.on(Events.InteractionCreate, (i: Interaction) => {
    if (i.isButton() && i.customId.startsWith("music:")) guard("MUSIC_PANEL", () => handlePanelButton(i));
    else if (i.isStringSelectMenu() && i.customId.startsWith("music:")) guard("MUSIC_SELECT", () => handleMusicSelect(i));
  });
  client.once(Events.ClientReady, () => guard("MUSIC_STARTUP", async () => {
    const rows = stmt.musicSessionAll.all();
    let panelsRemoved = 0, voiceLeft = 0;
    for (const row of rows) {
      const guild = client.guilds.cache.get(row.guild_id);
      if (!guild) { stmt.musicSessionDelete.run(row.guild_id); continue; }
      const channel = await resolveChannel(row.channel_id);
      if (channel) {
        await channel.messages.delete(row.message_id).catch(() => null);
        panelsRemoved++;
      }
      if (guild.members.me?.voice.channelId) {
        await guild.members.me.voice.disconnect().catch(() => null);
        voiceLeft++;
      }
      stmt.musicSessionDelete.run(row.guild_id);
    }
    if (rows.length) logger.info("[MUSIC] После перезапуска убрано панелей:", panelsRemoved, "· выходов из голосовых каналов:", voiceLeft);
  }));
}

function rememberPanel(guildId: string, channelId: string, messageId: string): void {
  try { stmt.musicSessionUpsert.run({ guild_id: guildId, channel_id: channelId, message_id: messageId, updated_at: Date.now() }); }
  catch (error) { logger.warn("[MUSIC] Не удалось сохранить панель для очистки после рестарта", guildId, error); }
}

function forgetPanel(guildId: string): void {
  panels.delete(guildId);
  try { stmt.musicSessionDelete.run(guildId); } catch { }
}

type PanelRef = { channelId: string; messageId: string };
const panels = new Map<string, PanelRef>();
const panelTimers = new Map<string, ReturnType<typeof setTimeout>>();
const panelBusy = new Set<string>();
const panelPending = new Set<string>();

function refreshPanel(guildId: string): void {
  if (panelBusy.has(guildId)) { panelPending.add(guildId); return; }
  if (panelTimers.has(guildId)) return;
  panelTimers.set(guildId, setTimeout(() => {
    panelTimers.delete(guildId);
    void runPanelRefresh(guildId);
  }, PANEL_DEBOUNCE_MS).unref());
}

async function runPanelRefresh(guildId: string): Promise<void> {
  panelBusy.add(guildId);
  try { await refreshPanelNow(guildId); } catch { /* ошибки внутри залогированы */ }
  finally {
    panelBusy.delete(guildId);
    if (panelPending.has(guildId)) { panelPending.delete(guildId); refreshPanel(guildId); }
  }
}

async function deletePanelMessage(ref: PanelRef): Promise<void> {
  const channel = await resolveChannel(ref.channelId);
  if (!channel) return;
  await channel.messages.delete(ref.messageId).catch(() => null);
}

async function refreshPanelNow(guildId: string): Promise<void> {
  const ref = panels.get(guildId);
  const state = playbackStateOf(guildId);
  if (!state) {
    if (ref) void deletePanelMessage(ref);
    forgetPanel(guildId);
    return;
  }
  const channelId = ref?.channelId ?? getSessionTextChannelId(guildId);
  if (!channelId) return;
  // Недоступный канал (негативный кэш, старт) НЕ отвязывает ссылку: следующее
  // обновление повторит правку. Отвязка — только на реальный 404.
  const channel = await resolveChannel(channelId);
  if (!channel) return;
  const payload = renderMusicPanel(state, guildLang(guildId));
  if (ref) {
    // Прямой PATCH по id — один REST-запрос без fetch сообщения.
    try {
      count("music.panel_edit");
      await channel.messages.edit(ref.messageId, payload);
      return;
    } catch (error) {
      // Пересоздаём только когда сообщение/канал реально исчезли; остальное
      // (rate limit, transient) — оставляем ссылку на следующий тик.
      if (!isMissingDiscordResource(error)) {
        logger.warn("[MUSIC] Панель не обновлена", guildId, error);
        return;
      }
      forgetPanel(guildId);
    }
  }
  try {
    const message = await channel.send(payload);
    panels.set(guildId, { channelId: channel.id, messageId: message.id });
    rememberPanel(guildId, channel.id, message.id);
  } catch (error) {
    logger.warn("[MUSIC] Панель не отправлена", guildId, error);
  }
}

async function handlePanelButton(i: ButtonInteraction): Promise<void> {
  const t = musicTFor(i.guildId ?? "");
  try {
    if (!i.inGuild()) return;
    const guildId = i.guildId;
    const queuePage = /^music:(remove|move):(\d+)$/.exec(i.customId);
    if (queuePage) {
      if (!isAdminInteraction(i)) {
        await i.reply({ content: t("notAdmin"), flags: MessageFlags.Ephemeral }).catch(() => null);
        return;
      }
      await openQueueMenu(i, queuePage[1] as "remove" | "move", Number(queuePage[2]), true);
      return;
    }
    const state = playbackStateOf(guildId);
    if (!state) {
      forgetPanel(guildId);
      await i.reply({ content: t("playerGone"), flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    const queueViewPage = /^music:queue:(\d+)$/.exec(i.customId);
    if (queueViewPage) {
      await openQueueView(i, Number(queueViewPage[1]), true);
      return;
    }
    if (i.customId === "music:queue") {
      await openQueueView(i, 0, false);
      return;
    }
    const isAdmin = isAdminInteraction(i);
    if (i.customId === "music:remove" || i.customId === "music:move") {
      if (!isAdmin) {
        await i.reply({ content: t("notAdmin"), flags: MessageFlags.Ephemeral }).catch(() => null);
        return;
      }
      await openQueueMenu(i, i.customId === "music:remove" ? "remove" : "move", 0, false);
      return;
    }
    if (state.current.requestedBy !== i.user.id && !isAdmin) {
      await i.reply({ content: t("notController"), flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    switch (i.customId.slice("music:".length)) {
      case "toggle": togglePause(guildId); break;          // notify перерисует панель
      case "skip": skipCurrent(guildId); break;
      case "shuffle": shuffleQueue(guildId); break;
      case "loop": cycleLoop(guildId); break;
      case "stop": {
        const ref = panels.get(guildId);
        forgetPanel(guildId);
        stopAndLeave(guildId);
        if (ref) void deletePanelMessage(ref);
        await i.reply({ content: t("stoppedAndLeft"), flags: MessageFlags.Ephemeral }).catch(() => null);
        return;
      }
      default: return;
    }
    await i.deferUpdate().catch(() => null);
  } catch (error) {
    failInteraction("[MUSIC] Кнопка панели не сработала", i, error, t("genericError"), i.guildId);
  }
}

type PendingMove = { from: number; at: number; id: string };
const pendingMoves = new Map<string, PendingMove>(); // ключ `${guildId}:${userId}`
/** Идентичность трека в очереди: перенос работает по ней, а не по индексу —
 *  индекс устаревает, если очередь изменилась между двумя шагами меню. */
const trackIdentity = (track: Track): string => `${track.query}\u0000${track.title}`;

/** Экран очереди: удаление или выбор трека для перемещения, с пагинацией по 25. */
async function openQueueMenu(i: ButtonInteraction, action: "remove" | "move", requestedPage: number, update: boolean): Promise<void> {
  const t = musicTFor(i.guildId ?? "");
  const removing = action === "remove";
  const { queue } = getQueueSnapshot(i.guildId!);
  if (!queue.length) {
    const payload = { content: t("queueEmpty"), components: [] };
    if (update) await i.update(payload).catch(() => null);
    else await i.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }
  const pages = Math.max(1, Math.ceil(queue.length / SELECT_OPTION_LIMIT));
  const page = Math.min(pages - 1, Math.max(0, Math.trunc(requestedPage)));
  const start = page * SELECT_OPTION_LIMIT;
  const end = Math.min(queue.length, start + SELECT_OPTION_LIMIT);
  const options = queue.slice(start, end).map((track, index) => {
    const position = start + index;
    return new StringSelectMenuOptionBuilder().setLabel(trackLabel(`${position + 1}. ${track.title}`, 100)).setValue(String(position));
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId(removing ? "music:rmsel" : "music:mvasrc")
    .setPlaceholder(t(removing ? "selectRemoveHeader" : "selectMoveTrack").slice(0, 100))
    .addOptions(options);
  const prompt = `${t(removing ? "selectRemoveHeader" : "selectMoveTrack")}${pages > 1 ? `\n${t("queuePage", { page: String(page + 1), pages: String(pages) })}` : ""}`;
  const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>().addComponents(menu),
  ];
  if (pages > 1) {
    components.push(new ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`music:${action}:${page - 1}`)
        .setLabel(t("queuePrev"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`music:${action}:${page + 1}`)
        .setLabel(t("queueNext"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pages - 1),
    ));
  }
  const payload = { content: prompt, components };
  if (update) await i.update(payload).catch(() => null);
  else await i.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => null);
}

async function openQueueView(i: ButtonInteraction, requestedPage: number, update: boolean): Promise<void> {
  const t = musicTFor(i.guildId ?? "");
  const view = queueView(i.guildId!, guildLang(i.guildId!), requestedPage);
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (view.pages > 1) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`music:queue:${view.page - 1}`)
        .setLabel(t("queuePrev"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(view.page === 0),
      new ButtonBuilder()
        .setCustomId(`music:queue:${view.page + 1}`)
        .setLabel(t("queueNext"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(view.page >= view.pages - 1),
    ));
  }
  const payload = { content: view.content, components };
  if (update) await i.update(payload).catch(() => null);
  else await i.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => null);
}

async function handleMusicSelect(i: StringSelectMenuInteraction): Promise<void> {
  const t = musicTFor(i.guildId ?? "");
  try {
    if (!i.inGuild()) return;
    const guildId = i.guildId;
    const deny = (content: string) => i.update({ content, components: [] }).catch(() => null);
    if (!isAdminInteraction(i)) { await deny(t("notAdmin")); return; }
    const action = i.customId.slice("music:".length);
    const { queue } = getQueueSnapshot(guildId);

    if (action === "rmsel") {
      const removed = removeQueueTracks(guildId, i.values.map(Number));
      await deny(removed.length ? t("removedDone", { n: removed.length }) : t("queueChanged"));
      return;
    }

    if (action === "mvasrc") {
      const from = Number(i.values[0]);
      if (!Number.isInteger(from) || from < 0 || from >= queue.length) { await deny(t("queueChanged")); return; }
      pendingMoves.set(`${guildId}:${i.user.id}`, { from, at: Date.now(), id: trackIdentity(queue[from]!) });
      const showCount = Math.min(queue.length, SELECT_OPTION_LIMIT - 1);
      const options: StringSelectMenuOptionBuilder[] = [];
      for (let slot = 0; slot < showCount; slot++) {
        options.push(new StringSelectMenuOptionBuilder()
          .setLabel(t("moveToPosition", { n: slot + 1 }))
          .setDescription(trackLabel(queue[slot]!.title, 100))
          .setValue(String(slot)));
      }
      options.push(new StringSelectMenuOptionBuilder().setLabel(t("moveToEnd")).setValue(String(queue.length)));
      const title = trackLabel(queue[from]!.title, 90);
      await i.update({
        content: `${t("selectMovePosition", { title })}${queue.length > showCount ? `\n${t("queueTruncatedNote")}` : ""}`,
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("music:mvadst").setPlaceholder(title).addOptions(options),
        )],
      }).catch(() => null);
      return;
    }

    if (action === "mvadst") {
      const key = `${guildId}:${i.user.id}`;
      const pending = pendingMoves.get(key);
      pendingMoves.delete(key); // шаг одноразовый: повтор — только через кнопку
      const to = Number(i.values[0]);
      if (!pending || Date.now() - pending.at > PENDING_MOVE_TTL_MS || !Number.isInteger(to)) { await deny(t("queueChanged")); return; }
      // Очередь могла измениться между шагами: переносим только тот же трек.
      const current = queue[pending.from];
      if (!current || trackIdentity(current) !== pending.id) { await deny(t("queueChanged")); return; }
      const moved = current;
      const at = moveQueueTrack(guildId, pending.from, to);
      await deny(at >= 0 && moved ? t("movedDone", { title: moved.title, n: at + 1 }) : t("queueChanged"));
      return;
    }
  } catch (error) {
    failInteraction("[MUSIC] Выбор в меню очереди не сработал", i, error, t("genericError"), i.guildId);
  }
}
