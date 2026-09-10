import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, type ButtonInteraction, type ChatInputCommandInteraction, type Client, type GuildMember, type Interaction, type Message, type StringSelectMenuInteraction } from "discord.js";
import { count, time } from "../perf.ts";
import { logger } from "../utils/logger.ts";
import { stmt } from "../db/statements.ts";
import { isMissingDiscordResource, replyInteractionError } from "../../lib/errors.ts";
import { guildLang, guildTr } from "../../lib/i18n/bot.ts";
import type { Locale } from "../../lib/i18n/core.ts";
import { musicTr } from "../../lib/i18n/bot/music.ts";
import { resolveChannel } from "../logging/index.ts";
import { musicSettingsFor } from "../../lib/music-settings.ts";
import {
  MAX_QUEUE, connectToVoice, cycleLoop, enqueueTrack, fmtTime,
  getSessionTextChannelId, getQueueSnapshot, hasCurrent, hydrateTrackMeta,
  moveToVoice, moveQueueTrack, pickFollowTarget, playNext,
  isSingleYouTubeVideoUrl, probeFfmpeg, probeOpus, probeYtDlp, playbackStateOf, queueSizeOf, refreshSessionActivity, removeQueueTracks, resolveTracks,
  setOnMusicChange, setOnTrackStart, setPlayerEnvironment, shuffleQueue, skipCurrent, stopAndLeave, togglePause,
  type LoopMode, type Track,
} from "../../lib/player/index.ts";

/** Потолок опций Discord для select-меню. */
const SELECT_CAP = 25;
/** Debounce перерисовки: серия notify (плейлист = десяток изменений за раз)
 *  даёт ОДНУ правку сообщения через 500 мс — один edit вместо ~50 fetch+edit
 *  и риска упереться в rate limit прямо во время /play. */
const PANEL_DEBOUNCE_MS = 500;
const PENDING_MOVE_TTL_MS = 5 * 60_000;

/** Переводчик музыкальных сообщений для гильдии. */
const musicTFor = (guildId: string) => guildTr(musicTr, guildId);

/** Переводчик для функций, где язык уже известен (очередь и панель). */
const musicT = (lang: Locale) => (k: Parameters<typeof musicTr>[1], v?: Record<string, string | number>) => musicTr(lang, k, v);

function isAdminInteraction(i: ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction): boolean {
  return Boolean((i.member as GuildMember | null)?.permissions?.has(PermissionFlagsBits.Administrator));
}

/** Регистрация обработчиков. Вызывается один раз из src/bot/index.ts. */
export function registerMusic(client: Client): void {
  setOnMusicChange(refreshPanel);
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
  client.on("voiceStateUpdate", (oldState, newState) => {
    // Свой мьют/деаф состав канала не меняет; свой ПЕРЕХОД — меняет: без
    // до конца трека (при loop=track — бесконечно).
    if (oldState.id === client.user!.id) {
      if (oldState.channelId !== newState.channelId) refreshSessionActivity(newState.guild.id);
      return;
    }
    const guildId = newState.guild.id;
    if (!getSessionTextChannelId(guildId)) return;
    if (oldState.channelId === newState.channelId) return;
    refreshSessionActivity(guildId);
  });
  client.on(Events.InteractionCreate, (i: Interaction) => {
    if (i.isButton() && i.customId.startsWith("music:")) void handlePanelButton(i);
    else if (i.isStringSelectMenu() && i.customId.startsWith("music:")) void handleMusicSelect(i);
  });
  client.once(Events.ClientReady, async () => {
    const rows = stmt.musicSessionAll.all() as { guild_id: string; channel_id: string; message_id: string }[];
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
  });
}

function rememberPanel(guildId: string, channelId: string, messageId: string): void {
  try { stmt.musicSessionUpsert.run(guildId, channelId, messageId, Date.now()); }
  catch (error) { logger.warn("[MUSIC] Не удалось сохранить панель для очистки после рестарта", guildId, error); }
}

function forgetPanel(guildId: string): void {
  panels.delete(guildId);
  try { stmt.musicSessionDelete.run(guildId); } catch { }
}

function memberHasAllowedRole(member: GuildMember, roles: string[]): boolean {
  return member.roles.cache.some(role => roles.includes(role.id));
}

/** Обработка музыкальных слэш-команд. Возвращает false, если команда не музыкальная. */
export async function handleMusicCommand(i: Interaction): Promise<boolean> {
  if (!i.isChatInputCommand() || i.commandName !== "play") return false; // управление — кнопками панели, не командами
  const t = musicTFor(i.guildId ?? "");

  try {
    if (!i.inGuild() || !i.member) {
      await i.reply({ content: t("notGuild"), flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const settings = musicSettingsFor(i.guildId!);

    if (settings.command_channel_id && i.channelId !== settings.command_channel_id) {
      await i.editReply({ content: t("wrongChannel", { channel: settings.command_channel_id }) });
      return true;
    }
    if (settings.allowed_role_ids.length > 0 && !isAdminInteraction(i) && !memberHasAllowedRole(i.member as GuildMember, settings.allowed_role_ids)) {
      await i.editReply({ content: t("noRoles") });
      return true;
    }

    const voiceChannel = (i.member as GuildMember).voice.channel;
    if (!voiceChannel) { await i.editReply(t("notInVoice")); return true; }
    if (settings.voice_channel_ids.length > 0 && !settings.voice_channel_ids.includes(voiceChannel.id)) {
      await i.editReply({ content: t("voiceNotAllowed", { channels: settings.voice_channel_ids.map(id => `<#${id}>`).join(", ") }) });
      return true;
    }
    // Права бота проверяем заранее: без «Подключаться» упадёт сам вход, а без
    // поломка, которую иначе никак не увидеть.
    const botPerms = voiceChannel.permissionsFor(i.guild!.members.me ?? i.guild!.roles.everyone);
    if (!botPerms?.has(PermissionFlagsBits.Connect)) {
      await i.editReply({ content: t("noConnectAccess", { channel: voiceChannel.id }) });
      return true;
    }
    if (!botPerms.has(PermissionFlagsBits.Speak)) {
      await i.editReply({ content: t("noSpeakAccess", { channel: voiceChannel.id }) });
      return true;
    }

    const query = i.options.getString("link", true).trim();
    count("music.play");
    const t0 = performance.now();
    // Подключаемся ДО проб: handshake идёт параллельно с проверками окружения.
    connectToVoice(i.guild!, voiceChannel.id, i.channelId!);
    const [ytdlpOk, ffmpegOk, opusOk] = await Promise.all([probeYtDlp(), probeFfmpeg(), probeOpus()]);
    time("music.probes", performance.now() - t0);
    if (!ytdlpOk) { await i.editReply(t("missingYtDlp")); return true; }
    if (!ffmpegOk) { await i.editReply(t("missingFfmpeg")); return true; }
    if (!opusOk) { await i.editReply(t("missingOpus")); return true; }

    // Fast-path: прямая YouTube-ссылка без list= идёт в очередь немедленно —
    // параллельной гидрацией и обновляют панель/очередь на лету.
    let tracks: Track[];
    let fastPath = false;
    if (isSingleYouTubeVideoUrl(query)) {
      fastPath = true;
      tracks = [{ query, title: query, requestedBy: i.user.id }];
    } else {
      const resolveStart = performance.now();
      const resolved = await resolveTracks(query, i.user.id);
      time("music.resolve", performance.now() - resolveStart);
      tracks = resolved.tracks;
      if (tracks.length === 0) {
        await i.editReply(
          resolved.error === "botcheck" ? t("botCheck")
          : resolved.error === "too-long" ? t("tooLong")
          : resolved.error === "unsupported-url" ? t("unsupportedUrl")
          : t("invalidQuery"),
        );
        return true;
      }
    }
    const room = MAX_QUEUE - queueSizeOf(i.guildId!);
    let added = 0;
    let firstTitle = "";
    for (const track of tracks.slice(0, Math.max(0, room))) {
      track.requestedBy = i.user.id;
      if (enqueueTrack(i.guildId!, track)) { added++; if (!firstTitle) firstTitle = track.title; }
    }
    if (added === 0) { await i.editReply(t("queueFull", { max: String(MAX_QUEUE) })); return true; }

    // Автостарт: если сейчас ничего не играет — сразу запускаем голову очереди.
    // не срабатывала и первый трек не начинал играть вовсе.
    if (!hasCurrent(i.guildId!)) {
      const started = playNext(i.guildId!);
      if (started) {
        if (fastPath) hydrateTrackMeta(started, i.guildId!);
        await i.editReply(fastPath ? t("launching") : t("nowPlaying", { title: started.title }));
        return true;
      }
    }
    if (fastPath) {
      // Fast-path — ровно один трек: гидрация подтянет название/длину в панель.
      hydrateTrackMeta(tracks[0]!, i.guildId!);
      await i.editReply(t("launching"));
      return true;
    }
    await i.editReply(tracks.length > 1
      ? t("playlistAdded", { title: firstTitle, n: String(added) })
      : t("addedToQueue", { title: firstTitle, position: String(queueSizeOf(i.guildId!)) }));
    return true;
  } catch (error) {
    logger.warn("[MUSIC] Команда не выполнена", i.guildId, error);
    if (i.isRepliable()) replyInteractionError(i, t("genericError"));
    return true;
  }
}

// Сообщение с кнопками (пауза, скип, шаффл, луп, очередь, выход) в канале,
// обновление создаёт заново. Управление — автор текущего трека или админ.

type PanelRef = { channelId: string; messageId: string; message?: Message };
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
  }, PANEL_DEBOUNCE_MS));
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

function queueView(guildId: string, lang: Locale): string {
  const t = musicT(lang);
  const { current, queue } = getQueueSnapshot(guildId);
  if (!current && queue.length === 0) return t("queueEmpty");
  const dur = (track: Track) => track.duration && track.duration > 0 ? ` · ${fmtTime(track.duration)}` : "";
  const lines = [
    current ? t("queueNow", { title: `${current.title}${dur(current)}` }) : "",
    ...queue.slice(0, SELECT_CAP).map((track, n) => `${n + 1}. ${track.title}${dur(track)}`),
  ];
  return `${t("queueHeader", { n: String(queue.length) })}\n${lines.filter(Boolean).join("\n").slice(0, 1900)}`;
}

function renderPanel(state: { current: Track; queuePreview: Track[]; queueLength: number; paused: boolean; loopMode: LoopMode }, lang: Locale): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const t = musicT(lang);
  const loopLabel = state.loopMode === "track" ? t("panelLoopTrack") : state.loopMode === "queue" ? t("panelLoopQueue") : t("panelLoopOff");
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${state.paused ? "⏸️" : "▶️"} ${state.current.title}`)
    .setDescription(state.queueLength
      ? `${t("panelUpNext")}\n${state.queuePreview.map((track, n) => `\`${n + 1}.\` ${track.title}`).join("\n")}`
      : t("panelQueueEmptyNote"))
    .addFields(
      { name: t("panelRequestedBy"), value: `<@${state.current.requestedBy}>`, inline: true },
      { name: t("panelStatusField"), value: `${state.paused ? t("panelStatusPaused") : t("panelStatusPlaying")} · ${t("panelLoopField")}: ${loopLabel}`, inline: true },
      { name: t("panelQueueSize"), value: String(state.queueLength), inline: true },
      // Длина трека появляется после гидрации метаданных (или сразу из плейлиста).
      ...(state.current.duration && state.current.duration > 0
        ? [{ name: t("panelDuration"), value: fmtTime(state.current.duration), inline: true }]
        : []),
    )
    .setFooter({ text: t("panelFooter") });
  if (/^https?:\/\//.test(state.current.query)) embed.setURL(state.current.query);
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("music:toggle").setLabel(state.paused ? t("btnResume") : t("btnPause")).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("music:skip").setLabel(t("btnSkip")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:shuffle").setLabel(t("btnShuffle")).setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("music:loop").setLabel(`${t("btnLoop")}: ${loopLabel}`).setStyle(state.loopMode === "off" ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder().setCustomId("music:queue").setLabel(t("btnQueue")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:stop").setLabel(t("btnStop")).setStyle(ButtonStyle.Danger),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("music:remove").setLabel(t("btnRemove")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:move").setLabel(t("btnMove")).setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row1, row2, row3] };
}

async function refreshPanelNow(guildId: string): Promise<void> {
  let ref = panels.get(guildId);
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
  const payload = renderPanel(state, guildLang(guildId));
  if (ref) {
    // Кэшированный объект Message → правка без GET. После выметания из кэша
    // discord.js один GET возвращает объект в ref.message, дальше снова edit.
    try {
      const message = ref.message ?? await channel.messages.fetch(ref.messageId);
      count("music.panel_edit");
      await message.edit(payload);
      ref.message = message;
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
    panels.set(guildId, { channelId: channel.id, messageId: message.id, message });
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
    const state = playbackStateOf(guildId);
    if (!state) {
      forgetPanel(guildId);
      await i.reply({ content: t("playerGone"), flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (i.customId === "music:queue") {
      await i.reply({ content: queueView(guildId, guildLang(guildId)), flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    const isAdmin = isAdminInteraction(i);
    if (i.customId === "music:remove" || i.customId === "music:move") {
      if (!isAdmin) {
        await i.reply({ content: t("notAdmin"), flags: MessageFlags.Ephemeral }).catch(() => null);
        return;
      }
      await openQueueMenu(i);
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
    logger.warn("[MUSIC] Кнопка панели не сработала", i.guildId, error);
    if (i.isRepliable()) replyInteractionError(i, t("genericError"));
  }
}

type PendingMove = { from: number; at: number };
const pendingMoves = new Map<string, PendingMove>(); // ключ `${guildId}:${userId}`

/** Первый экран: список очереди на удаление или выбор трека для перемещения. */
async function openQueueMenu(i: ButtonInteraction): Promise<void> {
  const t = musicTFor(i.guildId ?? "");
  const removing = i.customId === "music:remove";
  const { queue } = getQueueSnapshot(i.guildId!);
  if (!queue.length) {
    await i.reply({ content: t("queueEmpty"), flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }
  // Ленивая чистка протухших шагов перемещения — карта не растёт бесконечно.
  const now = Date.now();
  for (const [key, pending] of pendingMoves) if (now - pending.at > PENDING_MOVE_TTL_MS) pendingMoves.delete(key);
  const options = queue.slice(0, SELECT_CAP).map((track, n) =>
    new StringSelectMenuOptionBuilder().setLabel(`${n + 1}. ${track.title}`.slice(0, 100)).setValue(String(n)));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(removing ? "music:rmsel" : "music:mvasrc")
    .setPlaceholder(t(removing ? "selectRemoveHeader" : "selectMoveTrack").slice(0, 100))
    .addOptions(options);
  const prompt = `${t(removing ? "selectRemoveHeader" : "selectMoveTrack")}${queue.length > SELECT_CAP ? `\n${t("queueTruncatedNote")}` : ""}`;
  await i.reply({
    content: prompt,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  }).catch(() => null);
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
      pendingMoves.set(`${guildId}:${i.user.id}`, { from, at: Date.now() });
      const showCount = Math.min(queue.length, SELECT_CAP - 1);
      const options: StringSelectMenuOptionBuilder[] = [];
      for (let slot = 0; slot < showCount; slot++) {
        options.push(new StringSelectMenuOptionBuilder()
          .setLabel(t("moveToPosition", { n: slot + 1 }))
          .setDescription(queue[slot]!.title.slice(0, 100))
          .setValue(String(slot)));
      }
      options.push(new StringSelectMenuOptionBuilder().setLabel(t("moveToEnd")).setValue(String(queue.length)));
      const title = queue[from]!.title;
      await i.update({
        content: `${t("selectMovePosition", { title })}${queue.length > showCount ? `\n${t("queueTruncatedNote")}` : ""}`,
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("music:mvadst").setPlaceholder(title.slice(0, 100)).addOptions(options),
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
      const moved = queue[pending.from];
      const at = moveQueueTrack(guildId, pending.from, to);
      await deny(at >= 0 && moved ? t("movedDone", { title: moved.title, n: at + 1 }) : t("queueChanged"));
      return;
    }
  } catch (error) {
    logger.warn("[MUSIC] Выбор в меню очереди не сработал", i.guildId, error);
    if (i.isRepliable()) replyInteractionError(i, t("genericError"));
  }
}
