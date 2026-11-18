import { redirect } from "next/navigation.js";
import { SiteHeader } from "#components/site-header.tsx";
import { PageHeader } from "#components/page-header.tsx";
import { AdminPanel } from "#components/admin-panel.tsx";
import { accountAccess } from "#lib/access.ts";

export default async function AdminPage() {
  const access = await accountAccess();
  if (!access.authenticated) redirect("/login");

  return <main className="container page">
    <SiteHeader access={access} />
    <PageHeader
      eyebrow="GOPLAY · АДМИН"
      title="Администрирование"
      description="Управление ботом и его серверами."
    />
    {access.isAdmin ? <AdminPanel/> : <p className="error-note" role="alert">⚠ Админ-панель доступна только владельцу бота.</p>}
  </main>;
}
