import { Bot, Check, PanelsTopLeft, ShieldCheck, Sparkles, Tags } from "lucide-react";
import type { ReactNode } from "react";
import UserMenu from "../src/components/user-menu.tsx";
import { accountAccess } from "../src/lib/access.ts";

function GithubMark() {
  return <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
  </svg>;
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

const GITHUB_REPO = "https://github.com/VolRencs/GOPlay.bot";
const GITHUB_ISSUES = "https://github.com/VolRencs/GOPlay.bot/issues";
const GITHUB_LICENSE = "https://github.com/VolRencs/GOPlay.bot/blob/Dev/LICENSE";

const features = [
  [Sparkles, "Приветствия", "Текст, изображения и шаблоны для новых участников."],
  [ShieldCheck, "Защита", "Настраиваемые правила против спама, ссылок и флуда."],
  [Tags, "Роли", "Кнопки, меню и реакции для самостоятельного выбора ролей."],
  [PanelsTopLeft, "Сообщения", "Embed-сообщения, медиа и сохранённые шаблоны."],
] as const;

export default async function Home() {
  const invite = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID ?? ""}&scope=bot%20applications.commands&permissions=8`;
  const access = await accountAccess();

  return <main className="landing">
    <nav className="landing-nav" aria-label="Основная навигация">
      <a className="landing-brand" href="/"><img src="/bot-logo.png" alt="GOPlay"/><span>GOPlay</span></a>
      <div className="nav-user-area">
        <UserMenu access={access} />
      </div>
    </nav>
    <section className="hero">
      <div>
        <h1>Управляйте<br/><em>сервером проще.</em></h1>
        <p className="hero-text">Один бот и одна понятная панель для ежедневных задач вашего Discord-сервера.</p>
        <div className="hero-actions">
          <a className="btn" href={invite}><Bot size={18}/>Добавить бота</a>
          <a className="btn secondary" href="/dashboard">Открыть панель</a>
        </div>
        <ul className="hero-points">
          <li><Check size={16}/>Настройка без команд</li>
          <li><Check size={16}/>Роли и сообщения в одном месте</li>
          <li><Check size={16}/>Открытый код под GPL-3.0</li>
        </ul>
      </div>
      <div className="hero-art" aria-hidden="true"><div className="hero-ring"/><img src="/bot-logo.png" alt=""/></div>
    </section>
    <section className="feature-grid" aria-label="Возможности бота">
      {features.map(([Icon, title, text]) => <article className="feature-card" key={title}>
        <span className="feature-icon"><Icon size={21}/></span><h2>{title}</h2><p>{text}</p>
      </article>)}
    </section>
    <footer className="landing-footer">
      <p>GOPlay — открытый исходный код под <ExtLink href={GITHUB_LICENSE}>GPL-3.0</ExtLink>.</p>
      <nav className="landing-footer-links" aria-label="Ссылки проекта">
        <ExtLink href={GITHUB_REPO}><GithubMark/>GitHub</ExtLink>
        <ExtLink href={GITHUB_ISSUES}>Сообщить об ошибке</ExtLink>
      </nav>
    </footer>
  </main>;
}
