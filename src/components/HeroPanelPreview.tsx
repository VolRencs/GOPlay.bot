import { BarChart3, Bot, CalendarDays, Gavel, History, Medal, Mic2, Music, ScrollText, Settings, ShieldCheck, Sparkles, Tags, Image as ImageIcon } from "lucide-react";

const sidebarGroups = [
  {
    label: "Обзор",
    items: [
      { icon: BarChart3, label: "Статистика", active: true },
      { icon: History, label: "Журнал изменений" },
      { icon: Settings, label: "Настройки" },
    ],
  },
  {
    label: "Сообщество",
    items: [
      { icon: Sparkles, label: "Приветствие" },
      { icon: Tags, label: "Роли" },
      { icon: Medal, label: "Уровни" },
      { icon: CalendarDays, label: "События" },
    ],
  },
  {
    label: "Модерация",
    items: [
      { icon: ShieldCheck, label: "Автомодерация" },
      { icon: ScrollText, label: "Логи" },
      { icon: Gavel, label: "Апелляции" },
      { icon: Mic2, label: "Временные каналы" },
    ],
  },
  {
    label: "Контент",
    items: [
      { icon: ImageIcon, label: "Embeds" },
      { icon: Music, label: "Музыка" },
    ],
  },
] as const;

const statCards = [
  { label: "Участники", value: "1 284", hint: "сейчас на сервере" },
  { label: "Онлайн", value: "342", hint: "в сети сейчас" },
  { label: "Сообщения", value: "48 216", hint: "за 7 дней" },
  { label: "Приток участников", value: "+127", hint: "156 пришло · 29 ушло" },
] as const;

const chartDays = [
  { label: "22 окт", value: 5421 },
  { label: "23 окт", value: 6932 },
  { label: "24 окт", value: 4810 },
  { label: "25 окт", value: 8254 },
  { label: "26 окт", value: 9120 },
  { label: "27 окт", value: 6240 },
  { label: "28 окт", value: 7439 },
] as const;

const chartMax = Math.max(...chartDays.map((day) => day.value));
const chartAverage = Math.round(chartDays.reduce((sum, day) => sum + day.value, 0) / chartDays.length);
const number = new Intl.NumberFormat("ru-RU");

export function HeroPanelPreview() {
  return <div className="hero-panel" aria-hidden="true" inert>
    <div className="hero-panel-canvas">
      <div className="settings-shell">
        <aside className="sidebar">
          <div className="brand"><Bot size={22} /> GOPlay</div>
          <div className="sidebar-groups">
            {sidebarGroups.map((group) => <section className="sidebar-group" key={group.label}>
              <p className="sidebar-group-label">{group.label}</p>
              <div className="sidebar-group-items">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = "active" in item && item.active;
                  return <span className={active ? "nav-item active" : "nav-item"} key={item.label}>
                    <Icon size={18} />{item.label}
                  </span>;
                })}
              </div>
            </section>)}
          </div>
        </aside>
        <section className="settings-content">
          <header className="settings-top">
            <span className="back-link">← Все серверы</span>
            <div className="server-heading">
              <div className="server-heading-icon"><Bot size={24} /></div>
              <div className="server-heading-copy">
                <p className="eyebrow">GOPLAY · GOPlay</p>
                <h1>Статистика сервера</h1>
                <p className="page-description">Активность, участники и действия модерации за выбранный период.</p>
              </div>
            </div>
          </header>
          <section className="panel-stack">
            <div className="period-switch" role="group" aria-label="Период">
              <button type="button" tabIndex={-1}>24 часа</button>
              <button type="button" tabIndex={-1} className="active">7 дней</button>
              <button type="button" tabIndex={-1}>30 дней</button>
            </div>
            <div className="stat-cards">
              {statCards.map((card) => <article className="card stat-card" key={card.label}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <small>{card.hint}</small>
              </article>)}
            </div>
            <article className="card chart-card">
              <div className="section-title">
                <div>
                  <h2>Активность сообщества</h2>
                  <p className="muted">Сообщения по дням.</p>
                </div>
                <span className="chart-average-label">среднее {number.format(chartAverage)}</span>
              </div>
              <div className="activity-chart" role="img" aria-label={`Активность сообщества за 7 дней: пик ${number.format(chartMax)} сообщений, среднее ${number.format(chartAverage)}.`}>
                <i className="chart-average" style={{ bottom: `${Math.min(97, (chartAverage / chartMax) * 100)}%` }} />
                {chartDays.map((day) => <div className={day.value === chartMax ? "chart-day top" : "chart-day"} key={day.label}>
                  <span className="bar-wrap"><i className="bar" style={{ height: `${Math.max(2, (day.value / chartMax) * 100)}%` }} /></span>
                  <time>{day.label}</time>
                </div>)}
              </div>
            </article>
          </section>
        </section>
      </div>
    </div>
  </div>;
}
