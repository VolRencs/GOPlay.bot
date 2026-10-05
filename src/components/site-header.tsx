import UserMenu from "./user-menu.tsx";
import type { AccountAccess } from "../lib/access.ts";

export function SiteHeader({ access }: { access: AccountAccess }) {
  return (
    <header className="site-header">
      <a className="brand" href="/"><img src="/bot-logo.png" alt="GOPlay"/><span>GOPlay</span></a>
      <div className="nav-user-area"><UserMenu access={access} /></div>
    </header>
  );
}
