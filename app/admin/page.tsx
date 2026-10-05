import { redirect } from "next/navigation.js";
import { SiteHeader } from "../../src/components/site-header.tsx";
import { AdminPanel } from "../../src/components/admin-panel.tsx";
import { accountAccess } from "../../src/lib/access.ts";

export default async function AdminPage() {
  const access = await accountAccess();
  if (!access.authenticated) redirect("/login");

  return <main className="container page">
    <SiteHeader access={access} />
    <div className="page-heading">
      <div>
        <p className="eyebrow">GOPLAY · АДМИН</p>
        <h1>Администрирование</h1>
        <p className="muted">Управление ботом и его серверами.</p>
      </div>
    </div>
    {access.isAdmin ? <AdminPanel/> : <p className="error-note" role="alert">⚠ Админ-панель доступна только владельцу бота.</p>}
  </main>;
}
