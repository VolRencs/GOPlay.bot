"use client";

import { useEffect, useState } from "react";

type Guild = { id: string; name: string; icon: string | null };

export default function Dashboard() {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [error, setError] = useState("");
  const [reauth, setReauth] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadGuilds() {
      const response = await fetch("/api/guilds");
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Не удалось загрузить серверы.");
        setReauth(Boolean(body?.reauth));
        return;
      }
      setGuilds(await response.json());
    }
    void loadGuilds().catch(() => setError("Не удалось соединиться с сервером.")).finally(() => setLoading(false));
  }, []);

  return (
    <main className="wrap">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">GOPLAY · DASHBOARD</p>
          <h1>Ваши серверы</h1>
          <p className="muted">Выберите сервер, чтобы настроить бота.</p>
        </div>
        <a className="btn secondary" href="/">На главную</a>
      </div>
      {error && <><p className="error-note" role="alert">⚠ {error}</p>{reauth && <a className="btn" href="/login">Войти через Discord снова</a>}</>}
      {loading && <p className="loading" role="status">Загружаем серверы…</p>}
      {!error && !loading && !guilds.length && <p className="muted">Доступных серверов пока нет.</p>}
      <section className="guild-grid">
        {guilds.map(guild => (
          <a className="guild-card" href={`/dashboard/${guild.id}`} key={guild.id}>
            <div className="guild-avatar">{guild.icon ? <img src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`} alt=""/> : guild.name[0]}</div>
            <div>
              <h2>{guild.name}</h2>
              <span className="muted">Настроить сервер →</span>
            </div>
          </a>
        ))}
      </section>
    </main>
  );
}
