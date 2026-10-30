import { DEFAULT_MUSIC_LEAVE_SECONDS } from "../lib/constants.ts";
import { clampMusicSeconds } from "../lib/labels.ts";

export type MusicDomain = {
  command_channel_id: string | null;
  voice_channel_ids: string[];
  allowed_role_ids: string[];
  leave_after_seconds: number;
  playlists_enabled: boolean;
  playlist_role_ids: string[];
};

export type MusicDto = {
  commandChannelId: string | null;
  voiceChannelIds: string[];
  allowedRoleIds: string[];
  leaveAfterSeconds: number;
  playlistsEnabled: boolean;
  playlistRoleIds: string[];
};

export const musicDefaults: MusicDto = {
  commandChannelId: null,
  voiceChannelIds: [],
  allowedRoleIds: [],
  leaveAfterSeconds: DEFAULT_MUSIC_LEAVE_SECONDS,
  playlistsEnabled: true,
  playlistRoleIds: [],
};

export function toDto(domain: MusicDomain): MusicDto {
  return {
    commandChannelId: domain.command_channel_id,
    voiceChannelIds: [...domain.voice_channel_ids],
    allowedRoleIds: [...domain.allowed_role_ids],
    leaveAfterSeconds: domain.leave_after_seconds,
    playlistsEnabled: domain.playlists_enabled,
    playlistRoleIds: [...domain.playlist_role_ids],
  };
}

export function normalize(dto: MusicDto): MusicDto {
  return {
    commandChannelId: dto.commandChannelId || null,
    voiceChannelIds: [...dto.voiceChannelIds],
    allowedRoleIds: [...dto.allowedRoleIds],
    leaveAfterSeconds: dto.leaveAfterSeconds === 0 ? 0 : clampMusicSeconds(Math.round(dto.leaveAfterSeconds) || DEFAULT_MUSIC_LEAVE_SECONDS),
    playlistsEnabled: dto.playlistsEnabled,
    playlistRoleIds: [...dto.playlistRoleIds],
  };
}

export function fromDto(dto: MusicDto): MusicDomain {
  return {
    command_channel_id: dto.commandChannelId,
    voice_channel_ids: [...dto.voiceChannelIds],
    allowed_role_ids: [...dto.allowedRoleIds],
    leave_after_seconds: dto.leaveAfterSeconds,
    playlists_enabled: dto.playlistsEnabled,
    playlist_role_ids: [...dto.playlistRoleIds],
  };
}
