"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { apiGet, apiJson } from "./dashboard/api.ts";
import { useApiResource } from "./dashboard/hooks.ts";
import { CardHeader, ConfirmHost, confirmAction, formatNumber, ModalShell, StatCard, TemplateLibrary, TemplateRow, useAsyncAction } from "./dashboard/ui.tsx";
import type { AdminDataDto, AdminGuildDto } from "#contracts/dashboard.ts";

function uptime(ms: number) {
  const total = Math.floor(ms / 60_000), d = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60), m = total % 60;
  return `${d ? `${d} д ` : ""}${h} ч ${m} мин`;
}

export function AdminPanel() {
  const { data, error: loadError, reload } = useApiResource<AdminDataDto | null>(
    signal => apiGet<AdminDataDto>("/api/admin", signal),
    [],
    null,
  );
  const [actionError, setActionError] = useState("");
  const [leaveTarget, setLeaveTarget] = useState<AdminGuildDto | null>(null);
  const [notice, setNotice] = useState("");
  const { busy, run } = useAsyncAction();
  const error = actionError || loadError;
  const retry = () => { setActionError(""); reload(); };

  const doLeave = (wipe: boolean) => {
    if (!leaveTarget) return;
    const id = leaveTarget.id;
    run(async () => {
      setActionError(""); setNotice("");
      const sent = await apiJson<{ leftOnDiscord?: boolean; wiped?: boolean; warning?: string }>(`/api/admin/guilds/${id}`, "POST", { wipe }, "Не удалось выполнить выход.");
      if (!sent.ok) { setLeaveTarget(null); return setActionError(sent.error); }
      const result = sent.data;
      if (!result.leftOnDiscord && !wipe && !(await confirmAction("Бот уже не на этом сервере. Стереть оставшиеся данные?", "Стереть"))) return;
      if (!result.leftOnDiscord && !wipe) {
        const wiped = await apiJson<{ wiped?: boolean; warning?: string }>(`/api/admin/guilds/${id}`, "POST", { wipe: true }, "Не удалось стереть данные.");
        if (!wiped.ok) { setLeaveTarget(null); return setActionError(wiped.error); }
        setNotice(wiped.data.wiped === false ? (wiped.data.warning ?? "Данные стёрты не полностью.") : `Данные сервера «${leaveTarget.name}» полностью стёрты.`);
      } else if (wipe && result.wiped === false) {
        setNotice(result.warning ?? `Данные сервера «${leaveTarget.name}» стёрты не полностью.`);
      } else setNotice(wipe ? `Данные сервера «${leaveTarget.name}» полностью стёрты.` : `Бот вышел с сервера «${leaveTarget.name}».`);
      setLeaveTarget(null);
      reload();
    });
  };

  return <>
    {error && <p className="error-note" role="alert">⚠ {error} <button type="button" className="btn secondary small" onClick={retry}>Повторить</button></p>}
    {notice && <p className="notice" role="status">✓ {notice}</p>}
    <section className="panel-stack">
      {data === null ? null : (
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
            items={data.guilds}
            title="Серверы"
            description="Все серверы, где есть бот. Выход из сервера сохраняет настройки; стереть их можно отдельной кнопкой."
            empty="Бот пока не добавлен ни на один сервер."
          >
            {g => (
              <TemplateRow key={g.id} actions={
                <button type="button" className="btn danger" disabled={busy} onClick={() => setLeaveTarget(g)}><LogOut size={16}/>Выйти с сервера</button>
              }>
                <strong>{g.name}</strong>
                <p className="muted">{formatNumber(g.messages)} сообщений · {g.panels} панелей · {g.events} событий · ID {g.id}</p>
              </TemplateRow>
            )}
          </TemplateLibrary>
        </>
      )}
    </section>
    {leaveTarget && (
      <ModalShell labelledBy="leave-dialog-title" onClose={() => setLeaveTarget(null)}>
        <h2 id="leave-dialog-title">Выйти с сервера «{leaveTarget.name}»?</h2>
        <p className="muted">Выберите, что сделать с данными этого сервера в базе бота.</p>
        <div className="modal-actions modal-actions-column">
          <button type="button" className="btn" disabled={busy} onClick={() => void doLeave(false)}>Просто выйти</button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => doLeave(true)}>Выйти и стереть все данные</button>
          <button type="button" data-autofocus className="btn secondary" onClick={() => setLeaveTarget(null)}>Отмена</button>
        </div>
      </ModalShell>
    )}
    <ConfirmHost />
  </>;
}
