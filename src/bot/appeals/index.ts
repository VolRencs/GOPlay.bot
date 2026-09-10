import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type Client, type Interaction, type ModalSubmitInteraction } from "discord.js";
import { createAppeal, declineAppeal } from "../../lib/appeals.ts";
import { punishmentLabel } from "../../lib/labels.ts";
import { replyInteractionError } from "../../lib/errors.ts";
import { count } from "../perf.ts";
import { logger } from "../utils/logger.ts";
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
    logger.warn("[APPEALS] Взаимодействие не обработано", i.guildId ?? "dm", error);
    if (i.isRepliable()) replyInteractionError(i, trAppeals(guildLang(i.guildId ?? ""), "genericError"));
  }
}

type OfferContext = { action: "agree" | "decline"; guildId: string; punishmentId: number };

function parseOfferId(customId: string): OfferContext | null {
  const [, , action, guildId, punishmentIdRaw] = customId.split(":");
  const punishmentId = Number(punishmentIdRaw);
  if ((action !== "agree" && action !== "decline") || !guildId || !Number.isInteger(punishmentId)) return null;
  return { action, guildId, punishmentId };
}

async function handleOffer(i: ButtonInteraction) {
  const context = parseOfferId(i.customId);
  if (!context) return;
  count("appeals.offer");
  if (context.action === "agree") {
    const lang = guildLang(context.guildId);
    await i.showModal(new ModalBuilder().setCustomId(`appeal:modal:${context.guildId}:${context.punishmentId}`).setTitle(trAppeals(lang, "appealModalTitle")).addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("reason").setLabel(trAppeals(lang, "modalReasonLabel")).setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(4000).setRequired(true).setPlaceholder(trAppeals(lang, "modalReasonPh")))));
    return;
  }
  const result = declineAppeal({ guildId: context.guildId, userId: i.user.id, punishmentId: context.punishmentId });
  await i.reply({ content: result.ok ? trAppeals(guildLang(context.guildId), "declinedOk") : `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
  await i.message?.edit({ components: [] }).catch(() => null);
}

async function handleModal(i: ModalSubmitInteraction) {
  const [, , guildId, punishmentIdRaw] = i.customId.split(":");
  const punishmentId = Number(punishmentIdRaw);
  if (!guildId || !Number.isInteger(punishmentId)) return;
  count("appeals.modal");
  const reason = i.fields.getTextInputValue("reason").trim();
  const result = createAppeal({ guildId, userId: i.user.id, punishmentId, reason });
  if (!result.ok) return i.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
  await i.reply({ content: trAppeals(guildLang(guildId), "appealCreated", { number: String(result.value.number) }), flags: MessageFlags.Ephemeral });
  await i.message?.edit({ components: [] }).catch(() => null);
}

// Отправляется сразу после записи наказания (команды, автомод): юзер ещё в
// гильдии, DM доставаем; сбой (закрытые DM) проглатывается — наказание в силе.
export function offerAppeal(client: Client, input: { punishmentId: number; guildId: string; guildName: string; userId: string; type: string; reason: string | null }) {
  const lang = guildLang(input.guildId);
  const t = (k: Parameters<typeof trAppeals>[1], v?: Record<string,string|number>) => trAppeals(lang, k, v);
  const typeLabel = punishmentLabel(lang, input.type);
  const content = t("offerTitle", { server: input.guildName, type: typeLabel }) + (input.reason ? t("offerReason", { reason: input.reason }) : "") + t("offerBody");
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`appeal:offer:agree:${input.guildId}:${input.punishmentId}`).setLabel(t("btnAppeal")).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`appeal:offer:decline:${input.guildId}:${input.punishmentId}`).setLabel(t("btnDecline")).setStyle(ButtonStyle.Secondary),
  );
  return client.users.send(input.userId, { content: content.slice(0, 2000), components: [row] }).catch(() => null);
}
