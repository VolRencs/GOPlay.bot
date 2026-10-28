import type { Metadata } from "next";
import "./styles/tokens.css";
import "./styles/forms.css";
import "./styles/components.css";
import "./styles/landing.css";
import "./styles/shell.css";
import "./styles/panels.css";
import "./styles/data.css";
import "./styles/overlays.css";
import "./styles/responsive.css";

export const metadata: Metadata = {
  title: "GOPlay",
  description: "Панель управления Discord-ботом GOPlay",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body>{children}</body></html>;
}
