import { MessageFlags, type Interaction } from "discord.js";
import { count, time } from "../../lib/perf.ts";
import { failInteraction } from "../../lib/errors.ts";
import { channelRef } from "../../lib/format.ts";
import { musicSettingsFor } from "../../lib/music-settings.ts";
import {
  MAX_QUEUE, connectToVoice, enqueueTrack, hasCurrent, hydrateTrackMeta,
  isSingleYouTubeVideoUrl, playNext, probeFfmpeg, probeMusicBackend, probeOpus,
  queueSizeOf, resolveTracks, type ResolveErrorKind, type Track,
} from "../../lib/player/index.ts";
import { NO_MENTIONS, beginMusicCommand, canConnectAndSpeak, endMusicCommand, isAdminInteraction, leaveIfIdle, memberHasAllowedRole, musicTFor } from "./shared.ts";

type MusicKey = Parameters<ReturnType<typeof musicTFor>>[0];
const RESOLVE_ERROR_KEYS = {
  botcheck: "botCheck",
  "age-restricted": "ageRestricted",
  private: "privateVideo",
  unavailable: "unavailable",
  "unsupported-url": "unsupportedUrl",
  "invalid-query": "invalidQuery",
  "no-audio": "noAudio",
  cookies: "cookiesError",
  network: "networkError",
  "challenge-failed": "challengeFailed",
  "backend-unavailable": "missingMusicBackend",
  "too-long": "tooLong",
  unknown: "invalidQuery",
} as const satisfies Record<ResolveErrorKind, MusicKey>;
export async function handleMusicCommand(i: Interaction): Promise<boolean> {
  if (!i.isChatInputCommand() || i.commandName !== "play") return false;
  const t = musicTFor(i.guildId ?? "");
  let guildId: string | null = null;

  try {
    if (!i.inGuild() || !i.member) {
      await i.reply({ content: t("notGuild"), flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    const member = i.member;
    guildId = i.guildId;
    beginMusicCommand(guildId);
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const settings = musicSettingsFor(i.guildId!);

    if (settings.command_channel_id && i.channelId !== settings.command_channel_id) {
      await i.editReply({ content: t("wrongChannel", { channel: settings.command_channel_id }) });
      return true;
    }
    if (settings.allowed_role_ids.length > 0 && !isAdminInteraction(i) && !memberHasAllowedRole(member, settings.allowed_role_ids)) {
      await i.editReply({ content: t("noRoles") });
      return true;
    }

    const voiceChannel = "voice" in member ? member.voice.channel : null;
    if (!voiceChannel) { await i.editReply(t("notInVoice")); return true; }
    if (settings.voice_channel_ids.length > 0 && !settings.voice_channel_ids.includes(voiceChannel.id)) {
      await i.editReply({ content: t("voiceNotAllowed", { channels: settings.voice_channel_ids.map(channelRef).join(", ") }) });
      return true;
    }
    const botPerms = canConnectAndSpeak(voiceChannel, i.guild!.members.me);
    if (!botPerms.connect) {
      await i.editReply({ content: t("noConnectAccess", { channel: voiceChannel.id }) });
      return true;
    }
    if (!botPerms.speak) {
      await i.editReply({ content: t("noSpeakAccess", { channel: voiceChannel.id }) });
      return true;
    }

    const query = i.options.getString("link", true).trim();
    const playlistAllowed = settings.playlists_enabled && (
      settings.playlist_role_ids.length === 0 ||
      isAdminInteraction(i) ||
      memberHasAllowedRole(member, settings.playlist_role_ids)
    );
    const playlistLimit = playlistAllowed ? undefined : 1;
    const playlistNotice = !settings.playlists_enabled ? "playlistLimitedOff" : "playlistLimitedRole";
    count("music.play");
    const t0 = performance.now();
    const [backendOk, ffmpegOk, opusOk] = await Promise.all([probeMusicBackend(), probeFfmpeg(), probeOpus()]);
    time("music.probes", performance.now() - t0);
    if (!backendOk) { await i.editReply(t("missingMusicBackend")); leaveIfIdle(i.guildId); return true; }
    if (!ffmpegOk) { await i.editReply(t("missingFfmpeg")); leaveIfIdle(i.guildId); return true; }
    if (!opusOk) { await i.editReply(t("missingOpus")); leaveIfIdle(i.guildId); return true; }
    connectToVoice(i.guild!, voiceChannel.id, i.channelId!);

    let tracks: Track[];
    let fastPath = false;
    let limitedPlaylist = false;
    if (isSingleYouTubeVideoUrl(query)) {
      fastPath = true;
      tracks = [{ query, title: query, requestedBy: i.user.id }];
    } else {
      const resolveStart = performance.now();
      const resolved = await resolveTracks(query, i.user.id, playlistLimit);
      time("music.resolve", performance.now() - resolveStart);
      limitedPlaylist = resolved.playlist && !playlistAllowed;
      tracks = limitedPlaylist ? resolved.tracks.slice(0, 1) : resolved.tracks;
      if (tracks.length === 0) {
        await i.editReply(t(resolved.error ? RESOLVE_ERROR_KEYS[resolved.error] : "invalidQuery"));
        leaveIfIdle(i.guildId);
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
    if (added === 0) { await i.editReply(t("queueFull", { max: String(MAX_QUEUE) })); leaveIfIdle(i.guildId); return true; }

    if (!hasCurrent(i.guildId!)) {
      const started = playNext(i.guildId!);
      if (started) {
        if (fastPath) hydrateTrackMeta(started, i.guildId!);
        await i.editReply(fastPath && !limitedPlaylist
          ? t("launching")
          : { content: limitedPlaylist ? t(playlistNotice, { title: firstTitle }) : t("nowPlaying", { title: started.title }), allowedMentions: NO_MENTIONS });
        return true;
      }
    }
    if (fastPath) {
      hydrateTrackMeta(tracks[0]!, i.guildId!);
      await i.editReply(hasCurrent(i.guildId!)
        ? { content: t("addedToQueue", { title: firstTitle, position: String(queueSizeOf(i.guildId!)) }), allowedMentions: NO_MENTIONS }
        : t("launching"));
      return true;
    }
    if (limitedPlaylist) {
      await i.editReply({ content: t(playlistNotice, { title: firstTitle }), allowedMentions: NO_MENTIONS });
      return true;
    }
    await i.editReply({
      content: tracks.length > 1
        ? t("playlistAdded", { title: firstTitle, n: String(added) })
        : t("addedToQueue", { title: firstTitle, position: String(queueSizeOf(i.guildId!)) }),
      allowedMentions: NO_MENTIONS,
    });
    return true;
  } catch (error) {
    leaveIfIdle(i.guildId);
    failInteraction("[MUSIC] Команда не выполнена", i, error, t("genericError"), i.guildId);
    return true;
  } finally {
    if (guildId) endMusicCommand(guildId);
  }
}
