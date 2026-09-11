import type { NextConfig } from "next";
const config: NextConfig = {
  // resvg — нативный бинарь; голосовой стек тянуть в бандл нельзя:
  // prism-media резолвит опциональные зависимости (ffmpeg-static и т.п.),
  // которых нет — они не нужны, Opus кодирует системный ffmpeg.
  serverExternalPackages: ["@resvg/resvg-js", "@discordjs/voice", "prism-media"],

  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
};
export default config;
