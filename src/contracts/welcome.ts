import { parseImageConfig, type WelcomeImageConfig } from "../lib/welcome.ts";

export type WelcomeDomain = {
  enabled: number;
  channel_id: string | null;
  message: string;
  image_enabled: number;
  background_path: string | null;
  image_config_json: string;
  goodbye_enabled: number;
  goodbye_channel_id: string | null;
  goodbye_message: string;
};

export type WelcomeDto = {
  enabled: boolean;
  channelId: string | null;
  message: string;
  imageEnabled: boolean;
  backgroundPath: string | null;
  imageConfig: WelcomeImageConfig;
  goodbyeEnabled: boolean;
  goodbyeChannelId: string | null;
  goodbyeMessage: string;
};

export type WelcomeInput = Omit<WelcomeDto, "backgroundPath">;

export const welcomeDefaults: WelcomeDto = {
  enabled: false,
  channelId: null,
  message: "Добро пожаловать, {user}!",
  imageEnabled: false,
  backgroundPath: null,
  imageConfig: parseImageConfig("{}"),
  goodbyeEnabled: false,
  goodbyeChannelId: null,
  goodbyeMessage: "До встречи, {username}!",
};

export function toDto(domain: WelcomeDomain): WelcomeDto {
  return {
    enabled: Boolean(domain.enabled),
    channelId: domain.channel_id,
    message: domain.message,
    imageEnabled: Boolean(domain.image_enabled),
    backgroundPath: domain.background_path,
    imageConfig: parseImageConfig(domain.image_config_json),
    goodbyeEnabled: Boolean(domain.goodbye_enabled),
    goodbyeChannelId: domain.goodbye_channel_id,
    goodbyeMessage: domain.goodbye_message,
  };
}

export function fromDto(dto: WelcomeInput): WelcomeDomain {
  return {
    enabled: Number(dto.enabled),
    channel_id: dto.channelId,
    message: dto.message,
    image_enabled: Number(dto.imageEnabled),
    background_path: null,
    image_config_json: JSON.stringify(dto.imageConfig),
    goodbye_enabled: Number(dto.goodbyeEnabled),
    goodbye_channel_id: dto.goodbyeChannelId,
    goodbye_message: dto.goodbyeMessage,
  };
}

export function toWelcomeInput(dto: WelcomeDto): WelcomeInput {
  return {
    enabled: dto.enabled,
    channelId: dto.channelId,
    message: dto.message,
    imageEnabled: dto.imageEnabled,
    imageConfig: dto.imageConfig,
    goodbyeEnabled: dto.goodbyeEnabled,
    goodbyeChannelId: dto.goodbyeChannelId,
    goodbyeMessage: dto.goodbyeMessage,
  };
}
