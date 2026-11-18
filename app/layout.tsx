import type { Metadata, Viewport } from "next";
import "./styles/tokens.css";
import "./styles/shared.css";
import "./styles/app.css";
import "./styles/landing.css";

export const metadata: Metadata = {
  title: { default: "GOPlay — Discord-бот и панель управления", template: "%s · GOPlay" },
  description: "Один бот и одна понятная панель: приветствия, автомодерация, роли, события, музыка и статистика.",
  applicationName: "GOPlay",
};

export const viewport: Viewport = {
  themeColor: "#06010d",
  colorScheme: "dark",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body>{children}</body></html>;
}
