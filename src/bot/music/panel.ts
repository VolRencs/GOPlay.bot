import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";
import { BRAND_COLOR } from "../../lib/colors.ts";
import { fmtTime, getQueueSnapshot, type LoopMode, type Track } from "../../lib/player/index.ts";
import { trFor } from "../../lib/i18n/bot.ts";
import type { Locale } from "../../lib/i18n/core.ts";
import { musicTr } from "../../lib/i18n/bot/music.ts";
import { userRef } from "../../lib/mentions.ts";

/** Компактная строка трека: панель не должна падать от длинного названия YouTube. */
export const QUEUE_PAGE_SIZE = 10;

export const trackLabel = (title: string, limit = 180): string => {
  const flat = title.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

export type MusicPanelState = {
  current: Track;
  queuePreview: Track[];
  queueLength: number;
  paused: boolean;
  loopMode: LoopMode;
  positionSec: number;
};

const progressBar = (position: number, duration: number): string => {
  const width = 14;
  const ratio = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const filled = Math.round(ratio * width);
  return `${"▰".repeat(filled)}${"▱".repeat(width - filled)}`;
};

export type QueueView = { content: string; page: number; pages: number };

export function queueView(guildId: string, lang: Locale, requestedPage = 0): QueueView {
  const t = trFor(musicTr, lang);
  const { current, queue } = getQueueSnapshot(guildId);
  if (!current && queue.length === 0) return { content: t("queueEmpty"), page: 0, pages: 1 };
  const pages = Math.max(1, Math.ceil(queue.length / QUEUE_PAGE_SIZE));
  const page = Math.min(pages - 1, Math.max(0, Math.trunc(requestedPage)));
  const start = page * QUEUE_PAGE_SIZE;
  const duration = (track: Track) => track.duration && track.duration > 0 ? ` · ${fmtTime(track.duration)}` : "";
  const lines = [
    current ? t("queueNow", { title: `${trackLabel(current.title, 90)}${duration(current)}` }) : "",
    ...queue.slice(start, start + QUEUE_PAGE_SIZE).map((track, index) => `${start + index + 1}. ${trackLabel(track.title, 90)}${duration(track)}`),
  ];
  const pageNote = pages > 1 ? `\n${t("queuePage", { page: String(page + 1), pages: String(pages) })}` : "";
  return {
    content: `${t("queueHeader", { n: String(queue.length) })}\n${lines.filter(Boolean).join("\n")}${pageNote}`.slice(0, 1900),
    page,
    pages,
  };
}

/** Современная панель плеера на Components V2: один контейнер вместо embed + строк. */
export function renderMusicPanel(state: MusicPanelState, lang: Locale) {
  const t = trFor(musicTr, lang);
  const loopLabel = state.loopMode === "track" ? t("panelLoopTrack") : state.loopMode === "queue" ? t("panelLoopQueue") : t("panelLoopOff");
  const duration = state.current.duration ?? 0;
  const position = duration > 0 ? Math.min(duration, Math.max(0, state.positionSec)) : 0;
  const time = duration > 0 ? `${fmtTime(position)} / ${fmtTime(duration)}` : fmtTime(position);
  const title = `## ${state.paused ? "⏸️" : "▶️"} ${trackLabel(state.current.title, 220)}`;
  const meta = `-# ${time} · ${t("panelRequestedBy")}: ${userRef(state.current.requestedBy)} · ${t("panelLoopField")}: ${loopLabel}`;
  const progress = duration > 0 ? `\n\`${progressBar(position, duration)}\`` : "";
  const body = `${title}\n${meta}${progress}`;
  const queueText = state.queueLength
    ? `${t("panelUpNextCount", { n: String(state.queueLength) })}\n${state.queuePreview.map((track, index) => {
      const trackDuration = track.duration && track.duration > 0 ? ` · ${fmtTime(track.duration)}` : "";
      return `${index + 1}. ${trackLabel(track.title, 90)}${trackDuration}`;
    }).join("\n")}`
    : t("panelQueueEmptyNote");

  const container = new ContainerBuilder().setAccentColor(BRAND_COLOR);
  const text = new TextDisplayBuilder().setContent(body);
  const thumbnail = state.current.thumbnail;
  if (thumbnail && URL.canParse(thumbnail) && /^https?:\/\//i.test(thumbnail)) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text)
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(thumbnail)
            .setDescription(trackLabel(state.current.title, 200)),
        ),
    );
  } else {
    container.addTextDisplayComponents(text);
  }

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(queueText.slice(0, 3500)))
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("music:toggle").setLabel(state.paused ? t("btnResume") : t("btnPause")).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("music:skip").setLabel(t("btnSkip")).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("music:shuffle").setLabel(t("btnShuffle")).setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("music:loop").setLabel(`${t("btnLoop")}: ${loopLabel}`).setStyle(state.loopMode === "off" ? ButtonStyle.Secondary : ButtonStyle.Success),
        new ButtonBuilder().setCustomId("music:queue").setLabel(t("btnQueue")).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("music:stop").setLabel(t("btnStop")).setStyle(ButtonStyle.Danger),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("music:remove").setLabel(t("btnRemove")).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("music:move").setLabel(t("btnMove")).setStyle(ButtonStyle.Secondary),
      ),
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: { parse: [] },
  };
}
