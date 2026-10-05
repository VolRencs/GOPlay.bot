"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { apiGet, apiSend } from "./dashboard/api.ts";
import { CardHeader, ConfirmHost, confirmAction, formatNumber, ModalShell, StatCard, TemplateLibrary, useAsyncAction } from "./dashboard/ui.tsx";

type AdminGuild = { id: string; name: string; messages: number; panels: number; events: number };
type AdminData = { online: boolean; uptimeMs: number | null; guildCount: number; messages7d: number; moderation7d: number; members: number | null; guilds: AdminGuild[] };

function uptime(ms: number) {
  const total = Math.floor(ms / 60_000), d = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60), m = total % 60;
  return `${d ? `${d} д ` : ""}${h} ч ${m} мин`;
}

export function AdminPanel() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [leaveTarget, setLeaveTarget] = useState<AdminGuild | null>(null);
  const [notice, setNotice] = useState("");
  const { busy, run } = useAsyncAction();

  function refresh() {
    setError("");
    void apiGet<AdminData | null>("/api/admin", null).then(result => {
      if (!result) return setError("Не удалось загрузить данные.");
      setData(result);
    });
  }
  useEffect(() => { refresh(); }, []);

  const doLeave = (wipe: boolean) => {
    if (!leaveTarget) return;
    const id = leaveTarget.id;
    run(async () => {
      setError(""); setNotice("");
      const sent = await apiSend<{ leftOnDiscord?: boolean }>(`/api/admin/guilds/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wipe }) }, "Не удалось выполнить выход.");
      if (!sent.ok) return setError(sent.error);
      const result = sent.data;
      if (!result.leftOnDiscord && !wipe && !(await confirmAction("Бот уже не на этом сервере. Стереть оставшиеся данные?", "Стереть"))) return;
      if (!result.leftOnDiscord && !wipe) {
        const wiped = await apiSend(`/api/admin/guilds/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wipe: true }) }, "Не удалось стереть данные.");
        if (!wiped.ok) return setError(wiped.error);
        setNotice(`Данные сервера «${leaveTarget.name}» полностью стёрты.`);
      } else setNotice(wipe ? `Данные сервера «${leaveTarget.name}» полностью стёрты.` : `Бот вышел с сервера «${leaveTarget.name}».`);
      setLeaveTarget(null);
      refresh();
    });
  };

  return <>
    {error && <p className="error-note" role="alert">⚠ {error}</p>}
    {notice && <p className="loading" role="status">✓ {notice}</p>}
    <section className="panel-stack">
      {data === null ? (
        <p className="loading" role="status">Загружаем данные бота…</p>
      ) : (
        <>
          <article className="card settings-card">
            <CardHeader title={<>Статус бота <span className={`pill ${data.online ? "pill-ok" : "pill-err"}`}>{data.online ? "онлайн" : "оффлайн"}</span></>}
              muted={data.uptimeMs !== null ? `Uptime: ${uptime(data.uptimeMs)}.` : "Uptime недоступен."}/>
            <div className="stat-cards">
              <StatCard label="Серверов" value={formatNumber(data.guildCount)} hint="всего у бота"/>
              <StatCard label="Сообщения" value={formatNumber(data.messages7d)} hint="за 7 дней по всем серверам"/>
              <StatCard label="Модерация" value={formatNumber(data.moderation7d)} hint="срабатываний за 7 дней"/>
              <StatCard label="Участники" value={data.members !== null ? formatNumber(data.members) : "—"} hint="во всех серверах"/>
            </div>
          </article>
          <TemplateLibrary
            title="Серверы"
            note={data.guilds.length ? String(data.guilds.length) : undefined}
            description="Все серверы, где есть бот. Выход из сервера необратимо удаляет его настройки только после вашего выбора."
            empty="Бот пока не добавлен ни на один сервер."
          >
            {data.guilds.length > 0 ? (
              <div className="template-list">
                {data.guilds.map(g => (
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
  </>;
}
