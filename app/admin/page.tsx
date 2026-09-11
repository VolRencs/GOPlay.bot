"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { apiGet, apiSend } from "../../src/components/dashboard/api.ts";
import { CardHeader, ConfirmHost, confirmAction, formatNumber, ModalShell, TemplateLibrary, useAsyncAction } from "../../src/components/dashboard/ui.tsx";

type Overview = { online: boolean; uptimeMs: number | null; guilds: number; messages7d: number; moderation7d: number; members: number | null };
type AdminGuild = { id: string; name: string; messages: number; panels: number; events: number };


function uptime(ms: number) {
  const total = Math.floor(ms / 60_000), d = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60), m = total % 60;
  return `${d ? `${d} д ` : ""}${h} ч ${m} мин`;
}

export default function AdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [guilds, setGuilds] = useState<AdminGuild[]>([]);
  const [error, setError] = useState("");
  const [leaveTarget, setLeaveTarget] = useState<AdminGuild | null>(null);
  const [notice, setNotice] = useState("");
  const { busy, run } = useAsyncAction();

  function refresh() {
    setError("");
    void Promise.all([
      apiGet<Overview | null>("/api/admin/overview", null),
      apiGet<{ guilds?: AdminGuild[] } | null>("/api/admin/guilds", null),
    ]).then(([overviewData, guildData]) => {
      if (!overviewData || !guildData) return setError("Не удалось загрузить данные.");
      setOverview(overviewData);
      setGuilds(guildData.guilds ?? []);
    });
  }
  useEffect(() => { refresh(); }, []);

  const doLeave = (wipe: boolean) => {
    if (!leaveTarget) return;
    const id = leaveTarget.id;
    run(async () => {
      setError(""); setNotice("");
      const sent = await apiSend<{ leftOnDiscord?: boolean }>(`/api/admin/guilds/${id}/leave`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wipe }) }, "Не удалось выполнить выход.");
      if (!sent.ok) return setError(sent.error);
      const result = sent.data;
      if (!result.leftOnDiscord && !wipe && !(await confirmAction("Бот уже не на этом сервере. Стереть оставшиеся данные?", "Стереть"))) return;
      // Повторный запрос — только confirm-флоу: при явном wipe=true данные
      // уже стёрты первым вызовом, а его ответ обязан быть проверен.
      if (!result.leftOnDiscord && !wipe) {
        const wiped = await apiSend(`/api/admin/guilds/${id}/leave`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wipe: true }) }, "Не удалось стереть данные.");
        if (!wiped.ok) return setError(wiped.error);
        setNotice(`Данные сервера «${leaveTarget.name}» полностью стёрты.`);
      } else setNotice(wipe ? `Данные сервера «${leaveTarget.name}» полностью стёрты.` : `Бот вышел с сервера «${leaveTarget.name}».`);
      setLeaveTarget(null);
      refresh();
    });
  };

  return (
    <main className="wrap">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">GOPLAY · АДМИН</p>
          <h1>Администрирование</h1>
          <p className="muted">Управление ботом и его серверами.</p>
        </div>
        <a className="btn secondary" href="/">На главную</a>
      </div>
      {error && <p className="error-note" role="alert">⚠ {error}</p>}
      {notice && <p className="loading" role="status">✓ {notice}</p>}
      <section className="panel-stack">
        {overview === null ? (
          <p className="loading" role="status">Загружаем данные бота…</p>
        ) : (
          <>
            <article className="card settings-card">
              <CardHeader title={<>Статус бота <span className={`pill ${overview.online ? "pill-ok" : "pill-err"}`}>{overview.online ? "онлайн" : "оффлайн"}</span></>}
                muted={overview.uptimeMs !== null ? `Uptime: ${uptime(overview.uptimeMs)}.` : "Uptime недоступен."}/>
              <div className="stat-cards">
                <article className="card stat-card"><span>Серверов</span><strong>{formatNumber(overview.guilds)}</strong><small>всего у бота</small></article>
                <article className="card stat-card"><span>Сообщения</span><strong>{formatNumber(overview.messages7d)}</strong><small>за 7 дней по всем серверам</small></article>
                <article className="card stat-card"><span>Модерация</span><strong>{formatNumber(overview.moderation7d)}</strong><small>срабатываний за 7 дней</small></article>
                <article className="card stat-card"><span>Участники</span><strong>{overview.members !== null ? formatNumber(overview.members) : "—"}</strong><small>во всех серверах</small></article>
              </div>
            </article>
            <TemplateLibrary
              title="Серверы"
              note={guilds.length ? String(guilds.length) : undefined}
              description="Все серверы, где есть бот. Выход из сервера необратимо удаляет его настройки только после вашего выбора."
              empty="Бот пока не добавлен ни на один сервер."
            >
              {guilds.length > 0 ? (
                <div className="template-list">
                  {guilds.map(g => (
                    <article className="template-item" key={g.id}>
                      <div>
                        <strong>{g.name}</strong>
                        <p className="muted">{formatNumber(g.messages)} сообщений · {g.panels} панелей · {g.events} событий · ID {g.id}</p>
                      </div>
                      <div className="template-actions">
                        <button type="button" className="btn danger" disabled={busy} onClick={() => setLeaveTarget(g)}><LogOut size={16}/>Выйти с сервера</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </TemplateLibrary>
          </>
        )}
      </section>
      {leaveTarget && (
        <ModalShell labelledBy="leave-dialog-title" onClose={() => setLeaveTarget(null)}>
          <h2 id="leave-dialog-title">Выйти с сервера «{leaveTarget.name}»?</h2>
          <p className="muted">Выберите, что сделать с данными этого сервера в базе бота.</p>
          <div className="modal-actions modal-actions-column">
            <button type="button" className="btn" onClick={() => doLeave(false)}>Просто выйти</button>
            <button type="button" className="btn danger" disabled={busy} onClick={() => doLeave(true)}>Выйти и стереть все данные</button>
            <button type="button" data-autofocus className="btn secondary" onClick={() => setLeaveTarget(null)}>Отмена</button>
          </div>
        </ModalShell>
      )}
      <ConfirmHost />
    </main>
  );
}
