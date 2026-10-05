import { redirect } from "next/navigation.js";
import { Bot } from "lucide-react";
import { SiteHeader } from "../../src/components/site-header.tsx";
import { accessFrom } from "../../src/lib/access.ts";
import { DiscordRateLimitError, configuredGuilds, resolveSession, type DashboardGuild } from "../../src/lib/guild-access.ts";
import { discordInviteUrl } from "../../src/lib/constants.ts";

export default async function Dashboard() {
  const resolved = await resolveSession().catch(() => null);
  if (!resolved) redirect("/login");
  const access = await accessFrom(resolved);

  let guilds: DashboardGuild[] = [];
  let loadError = "";
  if (access.allowed) {
    try { guilds = await configuredGuilds(resolved.requestHeaders, resolved.discordAccount?.id); }
    catch (error) {
      loadError = error instanceof DiscordRateLimitError
        ? "Discord временно ограничил запросы. Обновите страницу через несколько секунд."
        : "Не удалось получить список серверов. Обновите страницу.";
    }
  }

  return <main className="container page">
    <SiteHeader access={access} />
    <div className="page-heading">
      <div>
        <p className="eyebrow">GOPLAY · DASHBOARD</p>
        <h1>Ваши серверы</h1>
        <p className="muted">Выберите сервер, чтобы настроить бота.</p>
      </div>
    </div>
    {!access.allowed && <p className="error-note" role="alert">⚠ У этого аккаунта нет доступа к панели.</p>}
    {loadError && <p className="error-note" role="alert">⚠ {loadError}</p>}
    {access.allowed && !loadError && (guilds.length ? (
      <section className="guild-grid">
        {guilds.map(guild => <a className="guild-card" href={`/dashboard/${guild.id}`} key={guild.id}>
          <div className="guild-avatar">{guild.icon ? <img src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`} alt=""/> : guild.name[0]}</div>
          <div>
            <h2>{guild.name}</h2>
            <span className="muted">Настроить сервер →</span>
          </div>
        </a>)}
      </section>
    ) : (
      <article className="card empty-state">
        <span className="tile"><Bot size={20}/></span>
        <h2>Серверов пока нет</h2>
        <p>Добавьте бота на сервер, где у вас есть право «Управление сервером», и он появится здесь.</p>
        <a className="btn" href={discordInviteUrl()}><Bot size={18}/>Добавить бота</a>
      </article>
    ))}
  </main>;
}
