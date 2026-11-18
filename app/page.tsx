import { Bot, PanelsTopLeft, ShieldCheck, Sparkles, Tags } from "lucide-react";
import { SiteHeader } from "#components/site-header.tsx";
import { accountAccess } from "#lib/access.ts";
import { discordInviteUrl } from "#lib/constants.ts";

const features = [
  [Sparkles, "Приветствия", "Текст, изображения и шаблоны для новых участников."],
  [ShieldCheck, "Защита", "Настраиваемые правила против спама, ссылок и флуда."],
  [Tags, "Роли", "Кнопки, меню и реакции для самостоятельного выбора ролей."],
  [PanelsTopLeft, "Сообщения", "Embed-сообщения, медиа и сохранённые шаблоны."],
] as const;

export default async function Home() {
  const access = await accountAccess();
  const inviteUrl = discordInviteUrl();

  return <main className="container page landing">
    <SiteHeader access={access} landing/>
    <section className="hero">
      <div>
        <p className="eyebrow">Discord-бот и панель управления</p>
        <h1>Управляйте сервером <span className="grad-text">проще.</span></h1>
        <p className="lead">Один бот и одна понятная панель: приветствия, автомодерация, роли, события, музыка и статистика.</p>
        <div className="hero-cta">
          <a className="btn lg" href={inviteUrl}><Bot size={18}/>Добавить бота</a>
        </div>
      </div>
      <div className="hero-art">
        <img
          src="/mascot.avif"
          width={1024}
          height={1536}
          alt="Маскот GOPlay — аниме-котёнок в наушниках"
          fetchPriority="high"
        />
      </div>
    </section>
    <section className="features">
      <div className="section-head">
        <h2>Всё нужное — в одной панели</h2>
        <p>Настройте сообщество без десятка ботов и разрозненных команд.</p>
      </div>
      <div className="feature-grid">
        {features.map(([Icon, title, text]) => <article className="card feature-card" key={title}>
          <span className="tile"><Icon size={20}/></span>
          <h2>{title}</h2>
          <p>{text}</p>
        </article>)}
      </div>
    </section>
  </main>;
}
