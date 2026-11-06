import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Events, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle, type ButtonInteraction, type Client, type Guild, type GuildChannelCreateOptions, type GuildMember, type Interaction, type ModalSubmitInteraction, type VoiceChannel, type VoiceState } from "discord.js";
import { stmt } from "../../db/statements.ts";
import { logger } from "../../lib/logger.ts";
import { failInteraction, guard, isMissingDiscordResource } from "../../lib/errors.ts";
import { count } from "../../lib/perf.ts";
import { ttlCacheSync } from "../../lib/cache.ts";
import { parseStringArray } from "../../lib/json.ts";
import { isSnowflake } from "../../lib/ids.ts";
import { DEFAULT_SETTINGS, type TempConfig } from "../../lib/tempchannels.ts";
import { stopAndLeave } from "../../lib/player/session.ts";
import { tempTr, guildTr } from "../../lib/i18n/bot.ts";
import { BRAND_COLOR } from "../../lib/colors.ts";
import { fetchMember } from "../utils/members.ts";

const SETTINGS_TTL = 10_000;
const configCache = ttlCacheSync<string, Map<string, TempConfig> | null>((guildId) => {
  const configs = new Map<string, TempConfig>();
  for (const preset of stmt.tempPresets.all(guildId)) {
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
  return template.replace(/\{(username|displayName|user)\}/g, (_token, key: string) =>
    key === "displayName" ? member.displayName : member.user.username,
  ).slice(0, 100);
}

export function registerTempChannels(client: Client) {
  client.on(Events.VoiceStateUpdate, (oldState, newState) => guard("TEMP_VOICE", () => handleVoiceState(oldState, newState)));
  client.on(Events.InteractionCreate, (i) => guard("TEMP_INTERACTION", () => handleInteraction(i)));
  client.on(Events.GuildMemberRemove, (member) => guard("TEMP_OWNER_LEAVE", () => handleOwnerLeave(member.guild, member.id)));
  client.on(Events.GuildDelete, (guild) => {
    configCache.delete(guild.id);
  });
}

async function handleOwnerLeave(guild: Guild, userId: string) {
  const row = stmt.tempByOwner.get(guild.id, userId);
  if (!row) return;
  const channel = await fetchTempChannel(guild, row.channel_id);
  if (channel === undefined) return;
  if (!channel) { stmt.tempDelete.run(row.channel_id); return; }
  const nextOwner = channel.members.find(m => !m.user.bot && !stmt.tempByOwner.get(guild.id, m.id))?.id;
  if (!nextOwner) {
    if (channel.members.some(m => !m.user.bot)) {
      logger.warn("[TEMP] Владелец ушёл, свободного получателя владения нет", guild.id, channel.id);
      return;
    }
    await deleteTempChannel(guild, channel, "[TEMP] Удаление канала ушедшего владельца не удалось");
    return;
  }
  stmt.tempUpdateOwner.run(nextOwner, channel.id);
}

async function handleVoiceState(oldState: VoiceState, newState: VoiceState) {
  count("events.voice_state");
  const guild = newState.guild ?? oldState.guild;
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const row = stmt.tempByChannel.get(oldState.channelId);
    if (row) scheduleEmptinessCheck(guild, oldState.channelId);
  }
  const config = guildConfig(guild.id);
  if (!config) return;
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  if (newState.channelId && newState.channelId !== oldState.channelId && config.has(newState.channelId)) {
    await handleTriggerJoin(guild, member, newState.channelId);
  }
}

async function handleTriggerJoin(guild: Guild, member: GuildMember, triggerChannelId: string) {
  const existing = stmt.tempByOwner.get(guild.id, member.id);
  if (existing) {
    const channel = guild.channels.cache.get(existing.channel_id) as VoiceChannel | undefined;
    if (channel) {
      if (member.voice.channelId !== channel.id) await member.voice.setChannel(channel).catch(() => null);
      return;
    }
    const fetched = await fetchTempChannel(guild, existing.channel_id);
    if (fetched === undefined) return;
    if (!fetched) stmt.tempDelete.run(existing.channel_id);
    else { if (member.voice.channelId !== existing.channel_id) await member.voice.setChannel(existing.channel_id).catch(() => null); return; }
  }
  await createTempChannel(guild, member, getConfig(guild.id, triggerChannelId), triggerChannelId);
}

// 10003 means the channel is really gone; other failures are transient and keep the DB row.
async function fetchTempChannel(guild: Guild, channelId: string): Promise<VoiceChannel | null | undefined> {
  return guild.channels.fetch(channelId).then(
    (value) => value as VoiceChannel | null,
    (error: unknown) => {
      if (!isMissingDiscordResource(error, "channel")) { logger.warn("[TEMP] Канал недоступен, строка сохранена", guild.id, channelId, error); return undefined; }
      return null;
    },
  );
}

function isTempEmpty(channel: VoiceChannel): boolean {
  return !channel.members.some((m) => !m.user.bot);
}

async function deleteTempChannel(guild: Guild, channel: VoiceChannel, failureMessage: string): Promise<void> {
  stmt.tempDelete.run(channel.id);
  if (guild.members.me?.voice.channelId === channel.id) stopAndLeave(guild.id);
  await channel.delete().catch((error) => logger.warn(failureMessage, guild.id, error));
}

const emptinessTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleEmptinessCheck(guild: Guild, channelId: string) {
  const existing = emptinessTimers.get(channelId);
  if (existing) clearTimeout(existing);
  emptinessTimers.set(channelId, setTimeout(async () => {
    emptinessTimers.delete(channelId);
    try {
      const channel = await fetchTempChannel(guild, channelId);
      if (channel === undefined) return;
      if (!channel) { stmt.tempDelete.run(channelId); return; }
      if (isTempEmpty(channel)) await deleteTempChannel(guild, channel, "[TEMP] Удаление пустого канала не удалось");
    } catch (error) {
      logger.warn("[TEMP] Проверка пустоты канала не удалась", guild.id, error);
    }
  }, 500));
}

async function createTempChannel(guild: Guild, member: GuildMember, settings: TempConfig, triggerChannelId: string) {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    logger.warn("[TEMP] Недостаточно прав ManageChannels", guild.id);
    return;
  }
  const options: GuildChannelCreateOptions = { name: renderName(settings.name_template, member), type: ChannelType.GuildVoice };
  if (settings.category_id) options.parent = settings.category_id;
  if (settings.user_limit > 0) options.userLimit = settings.user_limit;
  const source = guild.channels.cache.get(triggerChannelId) as VoiceChannel | undefined;
  if (source?.bitrate) options.bitrate = source.bitrate;
  const createVoiceChannel = async (opts: GuildChannelCreateOptions): Promise<VoiceChannel> => {
    const created = await guild.channels.create(opts);
    if (!created.isVoiceBased()) throw new Error(`Создан не голосовой канал (${created.type})`);
    return created;
  };
  let channel: VoiceChannel;
  try {
    channel = await createVoiceChannel(options);
  } catch (error) {
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
    await channel.delete().catch((deleteError) => logger.warn("[TEMP] Не удалось удалить канал после провала переноса", guild.id, deleteError));
    logger.warn("[TEMP] Не удалось переместить пользователя, канал удалён", guild.id, error);
    return;
  }
  // UNIQUE(guild_id, owner_id) makes concurrent room creation safe; the loser is deleted.
  try {
    stmt.tempInsert.run(guild.id, channel.id, member.id, null, triggerChannelId, Date.now());
  } catch (error) {
    await channel.delete().catch((deleteError) => logger.warn("[TEMP] Не удалось удалить дубликат канала", guild.id, deleteError));
    const winner = stmt.tempByOwner.get(guild.id, member.id);
    if (winner) {
      const target = guild.channels.cache.get(winner.channel_id);
      if (target?.type === ChannelType.GuildVoice && member.voice.channelId !== winner.channel_id) await member.voice.setChannel(target as VoiceChannel).catch(() => null);
    }
    logger.warn("[TEMP] Не удалось записать временный канал", guild.id, error);
    return;
  }
  const panel = await sendPanel(guild, channel);
  if (panel) stmt.tempUpdatePanel.run(panel.id, channel.id);
}

async function sendPanel(guild: Guild, channel: VoiceChannel) {
  const t = guildTr(tempTr, guild.id);
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(t("panelTitle"))
    .setDescription(t("panelDesc"));
  const buttons = (items: readonly (readonly [string, string, ButtonStyle])[]) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(items.map(([id, label, style]) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style)));
  const row = buttons([
    ["temp:rename", t("btnRename"), ButtonStyle.Primary],
    ["temp:limit", t("btnLimit"), ButtonStyle.Secondary],
    ["temp:lock", t("btnLock"), ButtonStyle.Secondary],
    ["temp:allow", t("btnAllow"), ButtonStyle.Success],
  ]);
  const row2 = buttons([
    ["temp:deny", t("btnDeny"), ButtonStyle.Danger],
    ["temp:transfer", t("btnTransfer"), ButtonStyle.Secondary],
    ["temp:delete", t("btnDelete"), ButtonStyle.Danger],
  ]);
  try {
    return await channel.send({ embeds: [embed], components: [row, row2] });
  } catch (error) {
    logger.warn("[TEMP] Панель управления не отправлена", guild.id, error);
    return null;
  }
}

async function handleInteraction(i: Interaction) {
  const t = guildTr(tempTr, i.guildId ?? "");
  try {
    if (i.isButton() && i.customId.startsWith("temp:")) await handlePanelButton(i, i.customId.slice("temp:".length));
    else if (i.isModalSubmit() && i.customId.startsWith("temp:modal-")) await handleModalSubmit(i, i.customId.slice("temp:modal-".length));
  } catch (error) {
    failInteraction("[TEMP] Действие панели не выполнено", i, error, t("genericError"), i.guildId);
  }
}

function voiceChannel(i: ButtonInteraction | ModalSubmitInteraction): VoiceChannel | null {
  const channel = i.channel;
  if (!channel || channel.type !== ChannelType.GuildVoice) return null;
  return channel as VoiceChannel;
}

function tempOwner(i: ButtonInteraction | ModalSubmitInteraction) {
  const guild = i.guild, channel = voiceChannel(i);
  const row = guild && channel ? stmt.tempByChannel.get(channel.id) : undefined;
  if (!guild || !channel || !row) return null;
  return { guild, channel, row, owner: row.owner_id === i.user.id };
}

async function handlePanelButton(i: ButtonInteraction, action: string) {
  const t = guildTr(tempTr, i.guildId ?? "");
  const context = tempOwner(i);
  if (!context) return;
  if (!context.owner) {
    await i.reply({ content: t("notOwner"), flags: MessageFlags.Ephemeral });
    return;
  }
  const { guild, channel } = context;
  const settings = getConfig(guild.id, context.row.source_channel_id);
  if (action === "rename") {
    if (settings.can_rename === 0) return i.reply({ content: t("renameDisabled"), flags: MessageFlags.Ephemeral });
    await i.showModal(textModal("temp:modal-rename", t("modalRenameTitle"), t("modalNameLabel"), channel.name));
  } else if (action === "limit") {
    if (settings.can_manage_access === 0) return i.reply({ content: t("manageDisabled"), flags: MessageFlags.Ephemeral });
    await i.showModal(textModal("temp:modal-limit", t("btnLimit"), t("modalLimitLabel"), String(channel.userLimit ?? 0)));
  } else if (action === "allow" || action === "deny") {
    if (settings.can_manage_access === 0) return i.reply({ content: t("accessDisabled"), flags: MessageFlags.Ephemeral });
    await i.showModal(textModal(`temp:modal-${action}`, action === "allow" ? t("btnAllow") : t("btnDeny"), t("modalUserPh")));
  } else if (action === "transfer") {
    if (settings.can_manage_access === 0) return i.reply({ content: t("manageDisabled"), flags: MessageFlags.Ephemeral });
    await i.showModal(textModal("temp:modal-transfer", t("btnTransfer"), t("modalNewOwnerLabel")));
  } else if (action === "lock") {
    if (settings.can_close === 0) return i.reply({ content: t("closeDisabled"), flags: MessageFlags.Ephemeral });
    const everyone = guild.roles.everyone;
    const closed = Boolean(channel.permissionOverwrites.cache.get(everyone.id)?.deny.has(PermissionFlagsBits.Connect));
    await i.reply({ content: closed ? t("channelOpened") : t("channelClosed"), flags: MessageFlags.Ephemeral });
    await channel.permissionOverwrites.edit(everyone, { Connect: closed ? null : false }).catch((error) => logger.warn("[TEMP] Не удалось изменить доступ", guild.id, error));
  } else if (action === "delete") {
    await i.reply({ content: t("deleting"), flags: MessageFlags.Ephemeral });
    await deleteTempChannel(guild, channel, "[TEMP] Удаление канала не удалось");
  }
}

async function handleModalSubmit(i: ModalSubmitInteraction, action: string) {
  const t = guildTr(tempTr, i.guildId ?? "");
  const context = tempOwner(i);
  if (!context?.owner) {
    await i.reply({ content: t("notOwner"), flags: MessageFlags.Ephemeral });
    return;
  }
  const { guild, channel, row } = context;
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
  if (!isSnowflake(targetId)) return i.reply({ content: t("badUser"), flags: MessageFlags.Ephemeral });
  const target = await fetchMember(guild, targetId);
  if (!target) return i.reply({ content: t("userNotFound"), flags: MessageFlags.Ephemeral });
  if (action === "allow" || action === "deny") {
    await channel.permissionOverwrites.edit(target, { Connect: action === "allow", Speak: action === "allow" }).catch((error) => logger.warn("[TEMP] Доступ не изменён", guild.id, error));
    return i.reply({ content: action === "allow" ? t("userAllowed",{id:targetId}) : t("userDenied",{id:targetId}), flags: MessageFlags.Ephemeral });
  }
  if (action === "transfer") {
    if (targetId === row.owner_id) return i.reply({ content: t("alreadyOwner"), flags: MessageFlags.Ephemeral });
    const targetOwns = stmt.tempByOwner.get(guild.id, targetId);
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

export async function cleanupTempChannels(client: Client) {
  const rows = stmt.tempAll.all();
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) { stmt.tempDelete.run(row.channel_id); continue; }
    const fetched = await fetchTempChannel(guild, row.channel_id);
    if (fetched === undefined) continue;
    if (!fetched) { stmt.tempDelete.run(row.channel_id); continue; }
    if (isTempEmpty(fetched)) {
      await deleteTempChannel(guild, fetched, "[TEMP] Удаление пустого канала не удалось");
      continue;
    }
    if (row.panel_message_id) {
      const message = await fetched.messages.fetch(row.panel_message_id).catch((error) => {
        if (isMissingDiscordResource(error, "message")) return null;
        logger.warn("[TEMP] Панель канала не проверена, повтор позже", row.guild_id, error);
        return "error" as const;
      });
      if (message) continue;
    }
    const panel = await sendPanel(guild, fetched);
    if (panel) stmt.tempUpdatePanel.run(panel.id, row.channel_id);
  }
  logger.info("[TEMP] Очистка временных каналов завершена, проверено:", rows.length);
}
