import { clampNumber } from "./constants.ts";

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

export type WelcomeLayout = {
  width: number;
  height: number;
  avatar: { cx: number; cy: number; rx: number; ry: number };
  title: { x: number; y: number; size: number; color: string };
  subtitle: { x: number; y: number; size: number; color: string };
};

export const WELCOME_DESIGN = { width: 900, height: 480 } as const;

const defaultImageConfig: WelcomeImageConfig = {
  avatarWidth: 164, avatarHeight: 164, avatarX: 450, avatarY: 175,
  title: "{displayName}", subtitle: "Добро пожаловать на {server}! · Участник #{count}",
  titleX: 450, titleY: 315, subtitleX: 450, subtitleY: 360,
  titleSize: 38, subtitleSize: 22,
  titleColor: "#f8fafc", subtitleColor: "#e2e8f0",
};

const number = (value: unknown, fallback: number, min: number, max: number) => clampNumber(value, fallback, min, max, "round");

const color = (value: unknown, fallback: string) => {
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return value;
  return fallback;
};

export function parseImageConfig(value: unknown): WelcomeImageConfig {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {  }
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

export function welcomeLayout(config: WelcomeImageConfig, width: number, height: number): WelcomeLayout {
  const scaleX = width / WELCOME_DESIGN.width;
  const scaleY = height / WELCOME_DESIGN.height;
  // Sizes follow scaleX (as the SVG preview always has), positions use both
  // axes. This keeps circles circular on non-16:9 backgrounds.
  const avatarWidth = config.avatarWidth * scaleX;
  const avatarHeight = config.avatarHeight * scaleX;
  return {
    width,
    height,
    avatar: {
      cx: config.avatarX * scaleX,
      cy: config.avatarY * scaleY,
      rx: avatarWidth / 2,
      ry: avatarHeight / 2,
    },
    title: {
      x: config.titleX * scaleX,
      y: config.titleY * scaleY,
      size: config.titleSize * scaleX,
      color: config.titleColor,
    },
    subtitle: {
      x: config.subtitleX * scaleX,
      y: config.subtitleY * scaleY,
      size: config.subtitleSize * scaleX,
      color: config.subtitleColor,
    },
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
  userAvatar: "",
  serverIcon: "",
};

export function welcomeValues(input: { name: string; username?: string; userId?: string; server: string; count: number; avatar: string }): Record<string, string> {
  return {
    user: input.name, username: input.username ?? input.name, displayName: input.name, server: input.server,
    count: String(input.count), memberCount: String(input.count), userId: input.userId ?? "", userAvatar: input.avatar, serverIcon: "",
  };
}

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[c] ?? c);

const MAX_IMAGE_DIMENSION = 4096;

export function clampImageSize(width: number, height: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export function imageSize(data: Buffer, fallback = { width: WELCOME_DESIGN.width, height: WELCOME_DESIGN.height }): { width: number; height: number } {
  try {
    if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return clampImageSize(data.readUInt32BE(16), data.readUInt32BE(20));
    if (data.length >= 10 && data.subarray(0, 3).toString() === "GIF") return clampImageSize(data.readUInt16LE(6), data.readUInt16LE(8));
    if (data.length >= 30 && data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP") {
      const fourcc = data.subarray(12, 16).toString();
      if (fourcc === "VP8X") return clampImageSize(data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1);
      if (fourcc === "VP8L" && data.length >= 25 && data[20] === 0x2f) { const bits = data.readUIntLE(21, 4); return clampImageSize((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1); }
      if (fourcc === "VP8 " && data.length >= 32) return clampImageSize(data.readUIntLE(26, 3) + 1, data.readUIntLE(29, 3) + 1);
      return fallback;
    }
    if (data.length >= 12 && data[0] === 0xff && data[1] === 0xd8) for (let i = 2; i < data.length - 9;) { if (data[i] !== 0xff) { i++; continue; } const marker=data[i+1] ?? 0, length=data.readUInt16BE(i+2); if (marker >= 0xc0 && marker <= 0xc3) return clampImageSize(data.readUInt16BE(i+7), data.readUInt16BE(i+5)); i += 2 + length; }
  } catch {  }
  return fallback;
}

export function buildWelcomeSvg(input: { backgroundHref?: string | null; backgroundWidth: number; backgroundHeight: number; avatarHref: string; title: string; subtitle: string; config: WelcomeImageConfig }) {
  const layout = welcomeLayout(input.config, input.backgroundWidth, input.backgroundHeight);
  const { avatar, title, subtitle } = layout;
  const bg = input.backgroundHref
    ? `<image href="${escapeXml(input.backgroundHref)}" width="${layout.width}" height="${layout.height}"/>`
    : `<defs><linearGradient id="g"><stop stop-color="#111827"/><stop offset="1" stop-color="#312e81"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`;
  const avatarMarkup = `<clipPath id="c"><ellipse cx="${avatar.cx}" cy="${avatar.cy}" rx="${avatar.rx}" ry="${avatar.ry}"/></clipPath>`
    + `<image href="${escapeXml(input.avatarHref)}" x="${avatar.cx - avatar.rx}" y="${avatar.cy - avatar.ry}" width="${avatar.rx * 2}" height="${avatar.ry * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>`;
  const titleMarkup = `<text x="${title.x}" y="${title.y}" text-anchor="middle" fill="${escapeXml(title.color)}" font-family="Onest, sans-serif" font-size="${title.size}" font-weight="700">${escapeXml(input.title)}</text>`;
  const subtitleMarkup = `<text x="${subtitle.x}" y="${subtitle.y}" text-anchor="middle" fill="${escapeXml(subtitle.color)}" font-family="Onest, sans-serif" font-size="${subtitle.size}">${escapeXml(input.subtitle)}</text>`;
  return `<svg viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="100%" height="100%" fill="#111827"/>${bg}`
    + `<rect width="100%" height="100%" fill="#000" opacity=".25"/>`
    + avatarMarkup + titleMarkup + subtitleMarkup
    + `</svg>`;
}
