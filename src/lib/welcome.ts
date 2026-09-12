export type WelcomeImageConfig = {
  avatarWidth: number;
  avatarHeight: number;
  avatarX: number;
  avatarY: number;
  title: string;
  subtitle: string;
  titleX: number;
  titleY: number;
  subtitleX: number;
  subtitleY: number;
  titleSize: number;
  subtitleSize: number;
  titleColor: string;
  subtitleColor: string;
};

const defaultImageConfig: WelcomeImageConfig = {
  avatarWidth: 164, avatarHeight: 164, avatarX: 450, avatarY: 175,
  title: "{displayName}", subtitle: "Добро пожаловать на {server}! · Участник #{count}",
  titleX: 450, titleY: 315, subtitleX: 450, subtitleY: 360,
  titleSize: 38, subtitleSize: 22,
  titleColor: "#f8fafc", subtitleColor: "#e2e8f0",
};

import { clampNumber } from "./constants.ts";

const number = (value: unknown, fallback: number, min: number, max: number) => clampNumber(value, fallback, min, max, "round");

const color = (value: unknown, fallback: string) => {
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return value;
  return fallback;
};

export function parseImageConfig(value: unknown): WelcomeImageConfig {
  let raw: Record<string, unknown> = {};
  try {
    // JSON.parse("null") не бросает: без проверки на объект raw.avatarWidth ниже падал бы 500.
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch { /* default configuration */ }
  return {
    avatarWidth: number(raw.avatarWidth, defaultImageConfig.avatarWidth, 48, 420),
    avatarHeight: number(raw.avatarHeight, defaultImageConfig.avatarHeight, 48, 420),
    avatarX: number(raw.avatarX, defaultImageConfig.avatarX, 0, 900),
    avatarY: number(raw.avatarY, defaultImageConfig.avatarY, 0, 480),
    title: typeof raw.title === "string" ? raw.title.slice(0, 120) : defaultImageConfig.title,
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle.slice(0, 180) : defaultImageConfig.subtitle,
    titleX: number(raw.titleX, defaultImageConfig.titleX, 0, 900),
    titleY: number(raw.titleY, defaultImageConfig.titleY, 0, 480),
    subtitleX: number(raw.subtitleX, defaultImageConfig.subtitleX, 0, 900),
    subtitleY: number(raw.subtitleY, defaultImageConfig.subtitleY, 0, 480),
    titleSize: number(raw.titleSize, defaultImageConfig.titleSize, 12, 96),
    subtitleSize: number(raw.subtitleSize, defaultImageConfig.subtitleSize, 10, 72),
    titleColor: color(raw.titleColor, defaultImageConfig.titleColor),
    subtitleColor: color(raw.subtitleColor, defaultImageConfig.subtitleColor),
  };
}

export function renderWelcomeTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{(user|username|displayName|server|count|memberCount|userId|userAvatar|serverIcon)\}/g, (token) => values[token.slice(1, -1)] ?? token);
}

export const welcomePreviewValues: Record<string, string> = {
  user: "Новый участник",
  username: "new_user",
  displayName: "Новый участник",
  server: "Ваш сервер",
  count: "123",
  memberCount: "123",
  userId: "000000000000000000",
};

export const welcomeDefaults: WelcomeGet = { enabled: 0, channel_id: null, message: "Добро пожаловать, {user}!", image_enabled: 0, background_path: null, image_config_json: "{}", goodbye_enabled: 0, goodbye_channel_id: null, goodbye_message: "До встречи, {username}!" };

export type WelcomeGet = {
  enabled: number; channel_id: string | null; message: string; image_enabled: number;
  background_path: string | null; image_config_json: string;
  goodbye_enabled: number; goodbye_channel_id: string | null; goodbye_message: string;
};

export type WelcomePutBody = {
  enabled: boolean;
  channelId: string | null;
  message: string;
  imageEnabled: boolean;
  imageConfig: WelcomeImageConfig;
  goodbyeEnabled: boolean;
  goodbyeChannelId: string | null;
  goodbyeMessage: string;
};

export function buildWelcomePutBody(w: WelcomeGet): WelcomePutBody {
  return {
    enabled: Boolean(w.enabled),
    channelId: w.channel_id,
    message: w.message,
    imageEnabled: Boolean(w.image_enabled),
    imageConfig: parseImageConfig(w.image_config_json),
    goodbyeEnabled: Boolean(w.goodbye_enabled),
    goodbyeChannelId: w.goodbye_channel_id,
    goodbyeMessage: w.goodbye_message,
  };
}

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[c] ?? c);

export const WELCOME_DESIGN = { width: 900, height: 480 } as const;

// Размеры из заголовков PNG/GIF/WEBP/JPEG без декодирования картинки.
// Значения атакер-контролируемые (5 МБ PNG может заявить 60000x60000):
// парсинг под охраной, результат клампится — иначе Resvg пытается растеризовать
// гигапиксельный холст и падает.
const MAX_IMAGE_DIMENSION = 4096;
const clampSize = ({ width, height }: { width: number; height: number }) => ({ width: Math.min(MAX_IMAGE_DIMENSION, Math.max(1, Math.round(width))), height: Math.min(MAX_IMAGE_DIMENSION, Math.max(1, Math.round(height))) });

export function imageSize(data: Buffer, fallback = { width: WELCOME_DESIGN.width, height: WELCOME_DESIGN.height }): { width: number; height: number } {
  try {
    if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return clampSize({ width: data.readUInt32BE(16), height: data.readUInt32BE(20) });
    if (data.length >= 10 && data.subarray(0, 3).toString() === "GIF") return clampSize({ width: data.readUInt16LE(6), height: data.readUInt16LE(8) });
    if (data.length >= 30 && data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP") {
      const fourcc = data.subarray(12, 16).toString();
      if (fourcc === "VP8X") return clampSize({ width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 });
      // Lossless VP8L: сигнатура 0x2f, затем LE32 с двумя 14-битными размерами (−1);
      // лосси-смещения 26/29 здесь указывают внутрь сжатого потока.
      if (fourcc === "VP8L" && data.length >= 25 && data[20] === 0x2f) { const bits = data.readUIntLE(21, 4); return clampSize({ width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }); }
      // Lossy VP8 (fourcc с хвостом-пробелом): размеры фрейма по смещениям 26/29.
      if (fourcc === "VP8 " && data.length >= 32) return clampSize({ width: data.readUIntLE(26, 3) + 1, height: data.readUIntLE(29, 3) + 1 });
      return fallback;
    }
    if (data.length >= 12 && data[0] === 0xff && data[1] === 0xd8) for (let i = 2; i < data.length - 9;) { if (data[i] !== 0xff) { i++; continue; } const marker=data[i+1] ?? 0, length=data.readUInt16BE(i+2); if (marker >= 0xc0 && marker <= 0xc3) return clampSize({ width:data.readUInt16BE(i+7), height:data.readUInt16BE(i+5) }); i += 2 + length; }
  } catch { /* truncated or malformed header */ }
  return fallback;
}

// SVG картинки приветствия, один шаблон на обоих потребителей: бот гонит его
// через Resvg в PNG для Discord, панель вставляет тот же markup инлайн —
// мгновенно и с идентичной раскладкой. Канва равна реальному размеру фона
// (фото показывается целиком и без искажений), элементы позиционируются
// пропорционально канве, а их размеры масштабируются одним коэффициентом по
// ширине — иначе на фоне с чужой пропорцией аватар превращался бы в овал.
// backgroundHref/avatarHref — data: URI у бота либо same-origin пути в превью.
export function buildWelcomeSvg(input: { backgroundHref?: string | null; backgroundWidth: number; backgroundHeight: number; avatarHref: string; title: string; subtitle: string; config: WelcomeImageConfig }) {
  const { config } = input;
  const scaleX = input.backgroundWidth / WELCOME_DESIGN.width, scaleY = input.backgroundHeight / WELCOME_DESIGN.height;
  const x = (value: number) => value * scaleX, y = (value: number) => value * scaleY;
  const size = (value: number) => value * scaleX;
  const aw = size(config.avatarWidth), ah = size(config.avatarHeight), ax = x(config.avatarX), ay = y(config.avatarY);
  const bg = input.backgroundHref
    ? `<image href="${escapeXml(input.backgroundHref)}" width="${input.backgroundWidth}" height="${input.backgroundHeight}"/>`
    : `<defs><linearGradient id="g"><stop stop-color="#111827"/><stop offset="1" stop-color="#312e81"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`;
  const avatar = `<clipPath id="c"><ellipse cx="${ax}" cy="${ay}" rx="${aw / 2}" ry="${ah / 2}"/></clipPath>`
    + `<image href="${escapeXml(input.avatarHref)}" x="${ax - aw / 2}" y="${ay - ah / 2}" width="${aw}" height="${ah}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>`;
  const title = `<text x="${x(config.titleX)}" y="${y(config.titleY)}" text-anchor="middle" fill="${escapeXml(config.titleColor)}" font-family="Noto Sans, sans-serif" font-size="${size(config.titleSize)}" font-weight="700">${escapeXml(input.title)}</text>`;
  const subtitle = `<text x="${x(config.subtitleX)}" y="${y(config.subtitleY)}" text-anchor="middle" fill="${escapeXml(config.subtitleColor)}" font-family="Noto Sans, sans-serif" font-size="${size(config.subtitleSize)}">${escapeXml(input.subtitle)}</text>`;
  return `<svg viewBox="0 0 ${input.backgroundWidth} ${input.backgroundHeight}" width="${input.backgroundWidth}" height="${input.backgroundHeight}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="100%" height="100%" fill="#111827"/>${bg}`
    + `<rect width="100%" height="100%" fill="#000" opacity=".25"/>`
    + avatar + title + subtitle
    + `</svg>`;
}
