import type { Metadata } from "next";
import "./styles/tokens.css";
import "./styles/shared.css";
import "./styles/app.css";
import "./styles/landing.css";

export const metadata: Metadata = {
  title: "GOPlay",
  description: "Панель управления Discord-ботом GOPlay",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body>{children}</body></html>;
}
