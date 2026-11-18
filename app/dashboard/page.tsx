import { redirect } from "next/navigation.js";
import NextLink from "next/link.js";
import type { ComponentProps, ComponentType } from "react";
import { Bot } from "lucide-react";
import { SiteHeader } from "#components/site-header.tsx";
import { PageHeader } from "#components/page-header.tsx";
import { accessFrom } from "#lib/access.ts";
import { DiscordRateLimitError, configuredGuilds, resolveSession, type DashboardGuild } from "#lib/guild-access.ts";
import { discordInviteUrl } from "#lib/constants.ts";
import { guildIconUrl } from "#lib/format.ts";

const Link = NextLink as unknown as ComponentType<ComponentProps<"a">>;

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
    <PageHeader
      eyebrow="GOPLAY · DASHBOARD"
      title="Ваши серверы"
      description="Выберите сервер, чтобы настроить бота."
      actions={<>
        {guilds.length > 0 && <span className="pill pill-accent">Серверов: {guilds.length}</span>}
        <a className="btn secondary" href={discordInviteUrl()}><Bot size={18}/>Добавить бота</a>
      </>}
    />
    {!access.allowed && <p className="error-note" role="alert">⚠ У этого аккаунта нет доступа к панели.</p>}
    {loadError && <p className="error-note" role="alert">⚠ {loadError}</p>}
    {access.allowed && !loadError && (guilds.length ? (
      <section className="guild-grid">
        {guilds.map(guild => <Link className="guild-card" href={`/dashboard/${guild.id}`} key={guild.id}>
          <div className="guild-avatar">{guildIconUrl(guild.id, guild.icon) ? <img src={guildIconUrl(guild.id, guild.icon)!} alt=""/> : guild.name[0]}</div>
          <div className="guild-card-copy">
            <h2>{guild.name}</h2>
            <span className="muted">Настроить сервер</span>
          </div>
          <span className="guild-card-arrow" aria-hidden="true">→</span>
        </Link>)}
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
