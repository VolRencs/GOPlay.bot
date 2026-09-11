"use client";

import { useEffect, useState } from "react";
import type { ServerStats, StatsGet } from "./types.ts";
import { apiGet } from "./api.ts";
import { CardHeader, formatNumber } from "./ui.tsx";


function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <article className="card stat-card"><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

type TopRow = { key: string; name: string; value: number };
function TopCard({ title, rows, empty, rank }: { title: string; rows: TopRow[] | undefined; empty: string; rank?: boolean }) {
  return (
    <article className="card settings-card">
      <h2>{title}</h2>
      {rows?.length ? (
        <div className="top-list">
          {rows.map((row, index) => (
            <div className="top-item" key={row.key}>
              {rank && <span className="top-rank">{index + 1}</span>}
              <span className="top-name">{row.name}</span>
              <span className="top-value">{formatNumber(row.value)}</span>
            </div>
          ))}
        </div>
      ) : <p className="hint">{empty}</p>}
    </article>
  );
}

export function ServerStatistics({ stats, guildId }: { stats: ServerStats; guildId: string }) {
  const [period, setPeriod] = useState<"24h" | "7d" | "30d">("7d");
  const [data, setData] = useState<StatsGet | null | undefined>(undefined);

  useEffect(() => {
    if (!guildId) return;
    const controller = new AbortController();
    setData(undefined);
    void apiGet<StatsGet | null>(`/api/guilds/${guildId}/stats?period=${period}`, null, controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(value); });
    return () => controller.abort();
  }, [guildId, period]);
  const loading = data === undefined;

  const totals = data?.totals ?? { joins: 0, leaves: 0, messages: 0, moderation: 0 };
  const points = data?.points ?? [];
  const max = Math.max(1, ...points.map(p => p.messages));
  const avg = points.length ? Math.round(points.reduce((sum, p) => sum + p.messages, 0) / points.length) : 0;
  const periodLabel = ({"24h":"за 24 часа","7d":"за 7 дней","30d":"за 30 дней"} as const)[period];
  const balance = totals.joins - totals.leaves;

  return (
    <section className="panel-stack">
      <div className="period-switch" role="group" aria-label="Период">
        {([["24h", "24 часа"], ["7d", "7 дней"], ["30d", "30 дней"]] as const).map(([key, label]) => (
          <button type="button" key={key} className={period === key ? "active" : ""} onClick={() => setPeriod(key)}>{label}</button>
        ))}
      </div>
      <div className="stat-cards">
        <StatCard label="Участники" value={stats.members != null ? formatNumber(stats.members) : "—"} hint="сейчас на сервере"/>
        <StatCard label="Онлайн" value={stats.online != null ? formatNumber(stats.online) : "—"} hint="в сети сейчас"/>
        <StatCard label="Сообщения" value={formatNumber(totals.messages)} hint={periodLabel}/>
        <StatCard label="Приток участников" value={balance >= 0 ? `+${formatNumber(balance)}` : formatNumber(balance)} hint={`${formatNumber(totals.joins)} пришло · ${formatNumber(totals.leaves)} ушло`}/>
      </div>
      <article className="card chart-card">
        <CardHeader title="Активность сообщества" muted={period === "24h" ? "Сообщения по часам." : "Сообщения по дням."}
          action={loading || !points.length ? null : <span className="chart-average-label">среднее {formatNumber(avg)}</span>}/>
        {loading ? <p className="hint" role="status">Загружаем статистику…</p> : !points.length ? <p className="hint">Пока нет данных {periodLabel}.</p> : (
          <div className="activity-chart" role="img" aria-label={`Активность сообщества ${periodLabel}: пик ${formatNumber(max)} сообщений, среднее ${formatNumber(avg)}.`}>
            <i className="chart-average" style={{ bottom: `${Math.min(97, (avg / max) * 100)}%` }}/>
            {points.map((p, index) => (
              <div className={`chart-day${p.messages === max ? " top" : ""}`} key={`${p.label}-${index}`} data-v={`${p.label} · ${formatNumber(p.messages)}`}>
                <span className="bar-wrap"><i className="bar" style={{ height: `${Math.max(2, (p.messages / max) * 100)}%` }}/></span>
                <time>{p.label}</time>
              </div>
            ))}
          </div>
        )}
      </article>
      <div className="stats-detail-grid">
        <TopCard title="Топ-каналы" rank rows={data?.topChannels.map(row => ({ key: row.id, name: `# ${row.name}`, value: row.messages }))} empty="Нет данных."/>
        <TopCard title="Топ-пользователи" rank rows={data?.topUsers.map(row => ({ key: row.id, name: row.name, value: row.messages }))} empty="Нет данных."/>
        <TopCard title="Модерация" rows={data?.moderation.map(row => ({ key: row.type, name: row.label, value: row.count }))} empty={`Нет действий модерации ${periodLabel}.`}/>
        <article className="card settings-card">
          <h2>Пик активности</h2>
          {data?.peakHour ? <p className="peak-value">{formatNumber(data.peakHour.messages)} <small>сообщений в час</small></p> : <p className="hint">Нет данных.</p>}
          <p className="muted">{data?.peakHour ? `${new Date(`${data.peakHour.day}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" })} ${String(data.peakHour.hour).padStart(2, "0")}:00 UTC` : "Час с наибольшим числом сообщений."}</p>
        </article>
      </div>
    </section>
  );
}
