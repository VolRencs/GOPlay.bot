import { Bot, Check, PanelsTopLeft, ShieldCheck, Sparkles, Tags } from "lucide-react";
import UserMenu from "../src/components/user-menu.tsx";
import { accountAccess } from "../src/lib/access.ts";

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
        <p className="eyebrow">GOPLAY · DISCORD BOT</p>
        <h1>Управляйте<br/><em>сервером проще.</em></h1>
        <p className="hero-text">Один бот и одна понятная панель для ежедневных задач вашего Discord-сервера.</p>
        <div className="hero-actions">
          <a className="btn" href={invite}><Bot size={18}/>Добавить бота</a>
          <a className="btn secondary" href="/dashboard">Открыть панель</a>
        </div>
        <ul className="hero-points">
          <li><Check size={16}/>Настройка без команд</li>
          <li><Check size={16}/>Роли и сообщения в одном месте</li>
        </ul>
      </div>
      <div className="hero-art" aria-hidden="true"><div className="hero-ring"/><img src="/bot-logo.png" alt=""/></div>
    </section>
    <section className="feature-grid" aria-label="Возможности бота">
      {features.map(([Icon, title, text]) => <article className="feature-card" key={title}>
        <span className="feature-icon"><Icon size={21}/></span><h2>{title}</h2><p>{text}</p>
      </article>)}
    </section>
  </main>;
}
