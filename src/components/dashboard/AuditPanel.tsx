"use client";

import { useEffect, useState } from "react";
import { cleanupTargets } from "../../../src/lib/labels.ts";
import { apiGet, apiSend } from "./api.ts";
import { CardHeader, confirmAction, formatTime, Select, useAsyncAction } from "./ui.tsx";
import type { AuditEntry, AuditListGet, PanelFail, PanelNotify } from "./types.ts";

const auditSections = ["Апелляции", "Автомодерация", "Embeds", "События", "Логи", "Приветствие", "Роли", "Временные каналы", "Очистка", "Настройки", "Музыка", "Уровни"];
export function DashboardAuditLog({ guildId }: { guildId: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [section, setSection] = useState("all");
  const load = async (nextOffset: number, append: boolean, signal?: AbortSignal) => {
    const params = new URLSearchParams({ limit: "50", offset: String(nextOffset) });
    if (section !== "all") params.set("section", section);
    const data = await apiGet<AuditListGet>(`/api/guilds/${guildId}/audit?${params}`, { entries: [], total: 0 }, signal);
    if (signal?.aborted) return;
    if (append) setEntries(value => [...(value ?? []), ...data.entries]);
    else setEntries(data.entries);
    setTotal(data.total);
  };
  useEffect(() => {
    if (!guildId) return;
    const controller = new AbortController();
    setEntries(null);
    setTotal(0);
    load(0, false, controller.signal);
    return () => controller.abort();
  }, [guildId, section]);
  return <section className="panel-stack"><article className="card settings-card">
      <CardHeader title="История изменений панели" note={total ? `${total} записей` : undefined}
        muted="Кто, что и когда менял в настройках этого сервера. Хранятся последние 1000 действий."
        action={<div className="audit-filter"><label>Раздел
          <Select value={section} onChange={setSection} ariaLabel="Раздел журнала"
            options={[{ value: "all", label: "Все разделы" }, ...auditSections.map(s => ({ value: s, label: s }))]}/>
        </label></div>}/>
    </article><article className="card audit-list">{entries === null ? <p className="muted" role="status">Загружаем журнал…</p> : entries.length ? entries.map(entry => <div className="audit-item" key={entry.id}><time dateTime={new Date(entry.created_at).toISOString()}>{formatTime(entry.created_at)}</time><span className="audit-user">{entry.user_name}</span><span className="pill pill-info">{entry.section}</span><p>{entry.summary}</p></div>) : <p className="muted">Изменений ещё не было — сохраните любые настройки, и они появятся здесь.</p>}{entries && entries.length < total && <button type="button" className="btn secondary" onClick={() => load(entries.length, true)}>Показать ещё ({entries.length} из {total})</button>}</article></section>;
}

export function ServerDataCleanup({ guildId, onDone, onError }: { guildId: string; onDone: PanelNotify; onError: PanelFail }) {
  const { busy, run } = useAsyncAction();
  const [active, setActive] = useState<string | null>(null);
  const runCleanup = (target: (typeof cleanupTargets)[number]) => run(async () => {
    if (!(await confirmAction(target.confirm, "Очистить"))) return;
    setActive(target.key);
    try {
      const sent = await apiSend<{ removed?: number }>(`/api/guilds/${guildId}/cleanup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: target.key }) }, "Не удалось очистить данные.");
      if (!sent.ok) return onError(sent.error);
      const removedCount = typeof sent.data.removed === "number" ? sent.data.removed : 0;
      onDone(`${target.done}${removedCount ? ` Удалено записей: ${removedCount}.` : ""}${target.key === "audit" ? " Запись об очистке останется в журнале." : ""}`);
    } finally {
      setActive(null);
    }
  });
  return (
    <article className="card settings-card">
      <CardHeader title="Очистка данных сервера" muted="Удаление записей этого сервера из базы бота. Действие необратимо — данные не восстанавливаются."/>
      <div className="cleanup-list">
        {cleanupTargets.map(target => (
          <div className="cleanup-item" key={target.key}>
            <div>
              <strong>{target.label}</strong>
              <p className="muted">{target.description}</p>
            </div>
            <button type="button" className="btn danger" disabled={busy} onClick={() => void runCleanup(target)}>{active === target.key ? "Очищаем…" : "Очистить"}</button>
          </div>
        ))}
      </div>
    </article>
  );
}
