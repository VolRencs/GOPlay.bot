import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Events, MessageFlags, ModalBuilder, PermissionsBitField, TextInputBuilder, TextInputStyle, type ButtonInteraction, type Client, type Guild, type GuildChannelCreateOptions, type GuildMember, type Interaction, type ModalSubmitInteraction, type VoiceChannel, type VoiceState } from "discord.js";
import { stmt } from "../db/statements.ts";
import { logger } from "../utils/logger.ts";
import { purgeGuild } from "../config-cache.ts";
import { count } from "../perf.ts";
import { ttlCacheSync } from "../../lib/cache.ts";
import { parseStringArray } from "../../lib/json.ts";
import { DEFAULT_SETTINGS, type TempConfig } from "../../lib/tempchannels.ts";
import { tempTr, guildLang } from "../../lib/i18n/bot.ts";
import { isMissingDiscordResource, replyInteractionError } from "../../lib/errors.ts";

type TempRow = { id: number; guild_id: string; channel_id: string; owner_id: string; panel_message_id: string | null; source_channel_id: string | null; created_at: number };
type TempPresetRow = TempConfig & { guild_id: string; name: string; trigger_channel_ids_json: string; updated_at: number };

// Короткий кэш: всплеск входящих в триггер-канал не бьёт по SQLite на каждый
// voice-event. Мапит триггер-канал в настройки пресета, где он указан.
const SETTINGS_TTL = 10_000;
const configCache = ttlCacheSync<string, Map<string, TempConfig> | null>((guildId) => {
  const configs = new Map<string, TempConfig>();
  for (const preset of stmt.tempPresets.all(guildId) as TempPresetRow[]) {
    const { category_id, name_template, user_limit, can_rename, can_manage_access, can_close } = preset;
    const value: TempConfig = { category_id, name_template, user_limit, can_rename, can_manage_access, can_close };
    for (const channelId of parseStringArray(preset.trigger_channel_ids_json)) configs.set(channelId, value);
  }
  return configs.size ? configs : null;
}, SETTINGS_TTL);

function guildConfig(guildId: string) {
  return configCache.get(guildId);
}

export function getConfig(guildId: string, sourceChannelId: string | null): TempConfig {
  const configs = guildConfig(guildId);
  if (!configs || !sourceChannelId) return DEFAULT_SETTINGS;
  return configs.get(sourceChannelId) ?? DEFAULT_SETTINGS;
}

export function renderName(template: string, member: { user: { username: string }; displayName: string }): string {
  return template.replace(/\{username\}/g, member.user.username).replace(/\{displayName\}/g, member.displayName).replace(/\{user\}/g, member.user.username).slice(0, 100);
}

export function registerTempChannels(client: Client) {
  client.on(Events.VoiceStateUpdate, (oldState, newState) => void handleVoiceState(oldState, newState));
  client.on(Events.InteractionCreate, (i) => void handleInteraction(i));
  // Вышедший владелец → канал передаётся первому оставшемуся участнику, а если
  // он пуст — удаляется. Иначе строка навсегда остаётся с мёртвым owner_id.
  client.on(Events.GuildMemberRemove, (member) => void handleOwnerLeave(member.guild, member.id));
  client.on(Events.GuildDelete, (guild) => {
    stmt.tempDeleteByGuild.run(guild.id);
    configCache.delete(guild.id);
    purgeGuild(guild.id);
  });
}

async function handleOwnerLeave(guild: Guild, userId: string) {
  const row = stmt.tempByOwner.get(guild.id, userId) as TempRow | undefined;
  if (!row) return;
  const channel = await guild.channels.fetch(row.channel_id).catch(() => null) as VoiceChannel | null;
  if (!channel) { stmt.tempDelete.run(row.channel_id); return; }
  const nextOwner = channel.members.find(m => !m.user.bot)?.id;
  if (!nextOwner) {
    stmt.tempDelete.run(channel.id);
    await channel.delete().catch((error) => logger.warn("[TEMP] Удаление канала ушедшего владельца не удалось", guild.id, error));
    return;
  }
  stmt.tempUpdateOwner.run(nextOwner, channel.id);
}

async function handleVoiceState(oldState: VoiceState, newState: VoiceState) {
  count("events.voice_state");
  const guild = newState.guild;
  const config = guildConfig(guild.id);
  if (!config) return;
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  if (newState.channelId && newState.channelId !== oldState.channelId && config.has(newState.channelId)) {
    await handleTriggerJoin(guild, member, newState.channelId);
  }
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const row = stmt.tempByChannel.get(oldState.channelId) as TempRow | undefined;
    if (row) scheduleEmptinessCheck(guild, oldState.channelId, oldState.channel as VoiceChannel | null);
  }
}

async function handleTriggerJoin(guild: Guild, member: GuildMember, triggerChannelId: string) {
  // Второй канал владельцу не создаём. Проверка не атомарна — два быстрых
  // voice-event оба могут её пройти — но UNIQUE (guild_id, owner_id) из
  // миграции 021 отвергнет проигравший insert, а дубликат канала удалится.
  const existing = stmt.tempByOwner.get(guild.id, member.id) as TempRow | undefined;
  if (existing) {
    const channel = guild.channels.cache.get(existing.channel_id) as VoiceChannel | undefined;
    if (channel) {
      if (member.voice.channelId !== channel.id) await member.voice.setChannel(channel).catch(() => null);
      return;
    }
    // Кэш может быть неполным после рестарта — проверяем REST-fetch'ем, прежде
    // чем считать строку протухшей и удалять её.
    const fetched = await guild.channels.fetch(existing.channel_id).catch(() => null) as VoiceChannel | null;
    if (!fetched) stmt.tempDelete.run(existing.channel_id);
    else { if (member.voice.channelId !== existing.channel_id) await member.voice.setChannel(existing.channel_id).catch(() => null); return; }
  }
  await createTempChannel(guild, member, getConfig(guild.id, triggerChannelId), triggerChannelId);
}

// 10003 = канал реально удалён; прочие сбои транзиентны (сеть, rate limit,
// авария API) и обязаны сохранять строку БД — иначе живой канал осиротеет.
function unknownChannel(error: unknown): boolean {
  return isMissingDiscordResource(error, "channel");
}

// Служебный fetch голосового канала: null — канал удалён (строку БД снимаем),
// undefined — транзиентный сбой (строку сохраняем до следующей попытки).
async function fetchTempChannel(guild: Guild, channelId: string): Promise<VoiceChannel | null | undefined> {
  return guild.channels.fetch(channelId).then(
    (value) => value as VoiceChannel | null,
    (error: unknown) => {
      if (!unknownChannel(error)) { logger.warn("[TEMP] Канал недоступен, строка сохранена", guild.id, channelId, error); return undefined; }
      return null as VoiceChannel | null;
    },
  );
}

// Один таймер на канал: уход всей компании эмитит по voice-event на каждого,
// коалесинг в одну проверку даёт ровно одно удаление канала (и его DB/REST).
const emptinessTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleEmptinessCheck(guild: Guild, channelId: string, cachedChannel: VoiceChannel | null) {
  const existing = emptinessTimers.get(channelId);
  if (existing) clearTimeout(existing);
  emptinessTimers.set(channelId, setTimeout(async () => {
    emptinessTimers.delete(channelId);
    try {
      const channel = cachedChannel ?? await fetchTempChannel(guild, channelId);
      if (channel === undefined) return; // транзиентный сбой — строка ждёт следующей проверки
      if (!channel) { stmt.tempDelete.run(channelId); return; }
      if (channel.members.size === 0) {
        stmt.tempDelete.run(channelId);
        await channel.delete().catch((error) => logger.warn("[TEMP] Удаление пустого канала не удалось", guild.id, error));
      }
    } catch (error) {
      logger.warn("[TEMP] Проверка пустоты канала не удалась", guild.id, error);
    }
  }, 500));
}

async function createTempChannel(guild: Guild, member: GuildMember, settings: TempConfig, triggerChannelId: string) {
  if (!guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    logger.warn("[TEMP] Недостаточно прав ManageChannels", guild.id);
    return;
  }
  const options: GuildChannelCreateOptions = { name: renderName(settings.name_template, member), type: ChannelType.GuildVoice };
  if (settings.category_id) options.parent = settings.category_id;
  if (settings.user_limit > 0) options.userLimit = settings.user_limit;
  // Битрейт наследуется от триггер-канала: буст сервера сохраняет качество.
  const source = guild.channels.cache.get(triggerChannelId) as VoiceChannel | undefined;
  if (source?.bitrate) options.bitrate = source.bitrate;
  // create() возвращает объединение каналов: убеждаемся, что это голосовой.
  const createVoiceChannel = async (opts: GuildChannelCreateOptions): Promise<VoiceChannel> => {
    const created = await guild.channels.create(opts);
    if (!created.isVoiceBased()) throw new Error(`Создан не голосовой канал (${created.type})`);
    return created;
  };
  let channel: VoiceChannel;
  try {
    channel = await createVoiceChannel(options);
  } catch (error) {
    // Настроенная категория могла быть удалена — ретрай без родителя.
    logger.warn("[TEMP] Создание канала не удалось, повтор без категории", guild.id, error);
    const retry = { ...options };
    delete retry.parent;
    try {
      channel = await createVoiceChannel(retry);
    } catch (err) {
      logger.error("[TEMP] Создание канала не удалось", guild.id, err);
      return;
    }
  }
  try {
    await member.voice.setChannel(channel);
  } catch (error) {
    // Юзер не дошёл до канала — удаляем комнату, а не оставляем сироту.
    await channel.delete().catch((deleteError) => logger.warn("[TEMP] Не удалось удалить канал после провала переноса", guild.id, deleteError));
    logger.warn("[TEMP] Не удалось переместить пользователя, канал удалён", guild.id, error);
    return;
  }
  try {
    stmt.tempInsert.run(guild.id, channel.id, member.id, null, triggerChannelId, Date.now());
  } catch (error) {
    // Проигравший гонку владельца (UNIQUE guild_id+owner_id) или сбой БД:
    // дубликат канала удаляется, юзера перекидывает в канал победителя.
    await channel.delete().catch((deleteError) => logger.warn("[TEMP] Не удалось удалить дубликат канала", guild.id, deleteError));
    const winner = stmt.tempByOwner.get(guild.id, member.id) as TempRow | undefined;
    if (winner) {
      const target = winner.channel_id === channel.id ? undefined : guild.channels.cache.get(winner.channel_id);
      if (target?.type === ChannelType.GuildVoice && member.voice.channelId !== winner.channel_id) await member.voice.setChannel(target as VoiceChannel).catch(() => null);
    }
    logger.warn("[TEMP] Не удалось записать временный канал", guild.id, error);
    return;
  }
  const panel = await sendPanel(guild, channel);
  if (panel) stmt.tempUpdatePanel.run(panel.id, channel.id);
}

async function sendPanel(guild: Guild, channel: VoiceChannel) {
  const lang = guildLang(guild.id);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(tempTr(lang, "panelTitle"))
    .setDescription(tempTr(lang, "panelDesc"));
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("temp:rename").setLabel(tempTr(lang, "btnRename")).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("temp:limit").setLabel(tempTr(lang, "btnLimit")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("temp:lock").setLabel(tempTr(lang, "btnLock")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("temp:allow").setLabel(tempTr(lang, "btnAllow")).setStyle(ButtonStyle.Success),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("temp:deny").setLabel(tempTr(lang, "btnDeny")).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("temp:transfer").setLabel(tempTr(lang, "btnTransfer")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("temp:delete").setLabel(tempTr(lang, "btnDelete")).setStyle(ButtonStyle.Danger),
  );
  try {
    return await channel.send({ embeds: [embed], components: [row1, row2] });
  } catch (error) {
    logger.warn("[TEMP] Панель управления не отправлена", guild.id, error);
    return null;
  }
}

async function handleInteraction(i: Interaction) {
  const t = (k2: Parameters<typeof tempTr>[1]) => tempTr(guildLang(i.guildId ?? ""), k2);
  try {
    if (i.isButton() && i.customId.startsWith("temp:")) await handlePanelButton(i, i.customId.slice("temp:".length));
    else if (i.isModalSubmit() && i.customId.startsWith("temp:modal-")) await handleModalSubmit(i, i.customId.slice("temp:modal-".length));
  } catch (error) {
    logger.warn("[TEMP] Действие панели не выполнено", i.guildId, error);
    if (i.isRepliable()) replyInteractionError(i, t("genericError"));
  }
}

function voiceChannel(i: ButtonInteraction | ModalSubmitInteraction): VoiceChannel | null {
  const channel = i.channel;
  if (!channel || channel.type !== ChannelType.GuildVoice) return null;
  return channel as VoiceChannel;
}

async function handlePanelButton(i: ButtonInteraction, action: string) {
  const t = (k: Parameters<typeof tempTr>[1], v?: Record<string,string|number>) => tempTr(guildLang(i.guildId ?? ""), k, v);
  const guild = i.guild;
  const channel = voiceChannel(i);
  if (!guild || !channel) return;
  const row = stmt.tempByChannel.get(channel.id) as TempRow | undefined;
  if (!row) return;
  if (row.owner_id !== i.user.id) {
    await i.reply({ content: t("notOwner"), flags: MessageFlags.Ephemeral });
    return;
  }
  const settings = getConfig(guild.id, row.source_channel_id);
  if (action === "rename") {
    if (settings.can_rename === 0) return i.reply({ content: t("renameDisabled"), flags: MessageFlags.Ephemeral });
    await i.showModal(textModal("temp:modal-rename", t("modalRenameTitle"), t("modalNameLabel"), channel.name));
  } else if (action === "limit") {
    if (settings.can_manage_access === 0) return i.reply({ content: t("manageDisabled"), flags: MessageFlags.Ephemeral });
    await i.showModal(textModal("temp:modal-limit", t("modalLimitTitle"), t("modalLimitLabel"), String(channel.userLimit ?? 0)));
  } else if (action === "allow" || action === "deny") {
    if (settings.can_manage_access === 0) return i.reply({ content: t("accessDisabled"), flags: MessageFlags.Ephemeral });
    await i.showModal(textModal(`temp:modal-${action}`, action === "allow" ? t("modalAllowTitle") : t("modalDenyTitle"), t("modalUserPh")));
  } else if (action === "transfer") {
    if (settings.can_manage_access === 0) return i.reply({ content: t("manageDisabled"), flags: MessageFlags.Ephemeral });
    await i.showModal(textModal("temp:modal-transfer", t("modalTransferTitle"), t("modalNewOwnerLabel")));
  } else if (action === "lock") {
    if (settings.can_close === 0) return i.reply({ content: t("closeDisabled"), flags: MessageFlags.Ephemeral });
    const everyone = guild.roles.everyone;
    const closed = Boolean(channel.permissionOverwrites.cache.get(everyone.id)?.deny.has(PermissionsBitField.Flags.Connect));
    // Сначала отвечаем interaction'у: edit оверрайтов — REST-вызов и может
    // не уложиться в 3-секундное окно Discord.
    await i.reply({ content: closed ? t("channelOpened") : t("channelClosed"), flags: MessageFlags.Ephemeral });
    await channel.permissionOverwrites.edit(everyone, { Connect: closed ? null : false }).catch((error) => logger.warn("[TEMP] Не удалось изменить доступ", guild.id, error));
  } else if (action === "delete") {
    await i.reply({ content: t("deleting"), flags: MessageFlags.Ephemeral });
    stmt.tempDelete.run(channel.id);
    await channel.delete().catch((error) => logger.warn("[TEMP] Удаление канала не удалось", guild.id, error));
  }
}

async function handleModalSubmit(i: ModalSubmitInteraction, action: string) {
  const t = (k: Parameters<typeof tempTr>[1], v?: Record<string,string|number>) => tempTr(guildLang(i.guildId ?? ""), k, v);
  const guild = i.guild;
  const channel = voiceChannel(i);
  if (!guild || !channel) return;
  const row = stmt.tempByChannel.get(channel.id) as TempRow | undefined;
  if (!row || row.owner_id !== i.user.id) {
    await i.reply({ content: t("notOwner"), flags: MessageFlags.Ephemeral });
    return;
  }
  const value = i.fields.getTextInputValue("value").trim();
  if (action === "rename") {
    if (!value.length) return i.reply({ content: t("emptyName"), flags: MessageFlags.Ephemeral });
    await channel.setName(value.slice(0, 100)).catch((error) => logger.warn("[TEMP] Переименование не удалось", guild.id, error));
    return i.reply({ content: t("renamed",{name:value.slice(0,100)}), flags: MessageFlags.Ephemeral });
  }
  if (action === "limit") {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 0 || limit > 99) return i.reply({ content: t("limitRange"), flags: MessageFlags.Ephemeral });
    await channel.setUserLimit(limit).catch((error) => logger.warn("[TEMP] Лимит не применён", guild.id, error));
    return i.reply({ content: limit ? t("limitSet",{n:String(limit)}) : t("limitOff"), flags: MessageFlags.Ephemeral });
  }
  const targetId = value.replace(/[<@!>]/g, "");
  if (!/^\d{15,22}$/.test(targetId)) return i.reply({ content: t("badUser"), flags: MessageFlags.Ephemeral });
  const target = await guild.members.fetch(targetId).catch(() => null);
  if (!target) return i.reply({ content: t("userNotFound"), flags: MessageFlags.Ephemeral });
  if (action === "allow" || action === "deny") {
    await channel.permissionOverwrites.edit(target, { Connect: action === "allow", Speak: action === "allow" }).catch((error) => logger.warn("[TEMP] Доступ не изменён", guild.id, error));
    return i.reply({ content: action === "allow" ? t("userAllowed",{id:targetId}) : t("userDenied",{id:targetId}), flags: MessageFlags.Ephemeral });
  }
  if (action === "transfer") {
    if (targetId === row.owner_id) return i.reply({ content: t("alreadyOwner"), flags: MessageFlags.Ephemeral });
    // UNIQUE(guild_id, owner_id): у цели может быть свой временный канал —
    // проверяем заранее, иначе сработает ограничение БД и уйдёт generic-ошибка.
    const targetOwns = stmt.tempByOwner.get(guild.id, targetId) as TempRow | undefined;
    if (targetOwns) return i.reply({ content: t("targetHasOwnChannel"), flags: MessageFlags.Ephemeral });
    stmt.tempUpdateOwner.run(targetId, channel.id);
    return i.reply({ content: t("transferred",{id:targetId}), flags: MessageFlags.Ephemeral });
  }
}

function textModal(customId: string, title: string, label: string, value = "") {
  return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("value").setLabel(label).setStyle(TextInputStyle.Short).setValue(value).setRequired(true).setMaxLength(100),
    ),
  );
}

// Запуск при старте: удаляем каналы без владельца внутри либо несуществующие,
// восстанавливаем потерянные панели. Дублей нет — строки матчатся по channel_id.
export async function cleanupTempChannels(client: Client) {
  const rows = stmt.tempAll.all() as TempRow[];
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) { stmt.tempDelete.run(row.channel_id); continue; }
    // Транзиентный сбой REST не должен терять строку: живой канал навсегда
    // лишится учёта владельца. Запись удаляет только 10003 (канал удалён).
    const fetched = await fetchTempChannel(guild, row.channel_id);
    if (fetched === undefined) continue;
    if (!fetched) { stmt.tempDelete.run(row.channel_id); continue; }
    if (fetched.members.size === 0) {
      stmt.tempDelete.run(row.channel_id);
      await fetched.delete().catch((error) => logger.warn("[TEMP] Очистка канала не удалась", row.guild_id, error));
      continue;
    }
    if (row.panel_message_id) {
      const message = await fetched.messages.fetch(row.panel_message_id).catch(() => null);
      if (message) continue;
    }
    const panel = await sendPanel(guild, fetched);
    if (panel) stmt.tempUpdatePanel.run(panel.id, row.channel_id);
  }
  logger.info("[TEMP] Очистка временных каналов завершена, проверено:", rows.length);
}