import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type Client, type Interaction, type ModalSubmitInteraction } from "discord.js";
import { appealPunishmentTypes, createAppeal, declineAppeal, type AppealPunishmentType } from "../../lib/appeals.ts";
import { punishmentLabel } from "../../lib/labels.ts";
import { failInteraction } from "../../lib/errors.ts";
import { count } from "../perf.ts";
import { guildLang } from "../../lib/i18n/bot.ts";
import { trAppeals } from "../../lib/i18n/bot/appeals.ts";

export function registerAppeals(client: Client) {
  client.on(Events.InteractionCreate, (i) => void handleInteraction(i));
}

async function handleInteraction(i: Interaction) {
  try {
    if (i.isButton() && i.customId.startsWith("appeal:offer:")) await handleOffer(i);
    else if (i.isModalSubmit() && i.customId.startsWith("appeal:modal:")) await handleModal(i);
  } catch (error) {
    failInteraction("[APPEALS] Взаимодействие не обработано", i, error, trAppeals(guildLang(i.guildId ?? ""), "genericError"), i.guildId ?? "dm");
  }
}

type OfferContext = { action: "agree" | "decline"; guildId: string; punishmentId: number; appealType: AppealPunishmentType };

function parseOfferId(customId: string): OfferContext | null {
  const [, , action, guildId, punishmentIdRaw, typeRaw] = customId.split(":");
  const punishmentId = Number(punishmentIdRaw);
  const appealType = appealPunishmentTypes.find(type => type === typeRaw);
  if ((action !== "agree" && action !== "decline") || !guildId || !Number.isInteger(punishmentId) || !appealType) return null;
  return { action, guildId, punishmentId, appealType };
}

async function handleOffer(i: ButtonInteraction) {
  const context = parseOfferId(i.customId);
  if (!context) return;
  count("appeals.offer");
  if (context.action === "agree") {
    const lang = guildLang(context.guildId);
    await i.showModal(new ModalBuilder().setCustomId(`appeal:modal:${context.guildId}:${context.punishmentId}:${context.appealType}`).setTitle(trAppeals(lang, "appealModalTitle")).addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("reason").setLabel(trAppeals(lang, "modalReasonLabel")).setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(4000).setRequired(true).setPlaceholder(trAppeals(lang, "modalReasonPh")))));
    return;
  }
  const result = declineAppeal({ guildId: context.guildId, userId: i.user.id, punishmentId: context.punishmentId });
  await i.reply({ content: result.ok ? trAppeals(guildLang(context.guildId), "declinedOk") : `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
  await i.message?.edit({ components: [] }).catch(() => null);
}

async function handleModal(i: ModalSubmitInteraction) {
  const [, , guildId, punishmentIdRaw, typeRaw] = i.customId.split(":");
  const punishmentId = Number(punishmentIdRaw);
  const appealType = appealPunishmentTypes.find(type => type === typeRaw);
  if (!guildId || !Number.isInteger(punishmentId) || !appealType) return;
  count("appeals.modal");
  const reason = i.fields.getTextInputValue("reason").trim();
  const result = createAppeal({ guildId, userId: i.user.id, punishmentId, reason, type: appealType });
  if (!result.ok) return i.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
  await i.reply({ content: trAppeals(guildLang(guildId), "appealCreated", { number: String(result.value.number) }), flags: MessageFlags.Ephemeral });
  await i.message?.edit({ components: [] }).catch(() => null);
}

// Отправляется сразу после записи наказания (команды, автомод): юзер ещё в
// гильдии, DM доставаем; сбой (закрытые DM) проглатывается — наказание в силе.
export function offerAppeal(client: Client, input: { punishmentId: number; guildId: string; guildName: string; userId: string; type: string; reason: string | null; appealType: AppealPunishmentType }) {
  const lang = guildLang(input.guildId);
  const t = (k: Parameters<typeof trAppeals>[1], v?: Record<string,string|number>) => trAppeals(lang, k, v);
  const typeLabel = punishmentLabel(lang, input.type);
  const content = t("offerTitle", { server: input.guildName, type: typeLabel }) + (input.reason ? t("offerReason", { reason: input.reason }) : "") + t("offerBody");
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`appeal:offer:agree:${input.guildId}:${input.punishmentId}:${input.appealType}`).setLabel(t("btnAppeal")).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`appeal:offer:decline:${input.guildId}:${input.punishmentId}:${input.appealType}`).setLabel(t("btnDecline")).setStyle(ButtonStyle.Secondary),
  );
  return client.users.send(input.userId, { content: content.slice(0, 2000), components: [row] }).catch(() => null);
}
