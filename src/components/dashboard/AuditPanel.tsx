"use client";

import { useEffect, useRef, useState } from "react";
import { cleanupTargets } from "../../../src/lib/labels.ts";
import { apiGet, apiSend } from "./api.ts";
import { useApiResource, usePanelAction } from "./hooks.ts";
import { CardHeader, confirmAction, formatTime, Select } from "./ui.tsx";
import type { AuditListGet, PanelFail, PanelNotify } from "./types.ts";

const auditSections = ["Апелляции", "Автомодерация", "Embeds", "События", "Логи", "Приветствие", "Роли", "Временные каналы", "Очистка", "Настройки", "Музыка", "Уровни"];
export function DashboardAuditLog({ guildId }: { guildId: string }) {
  const [section, setSection] = useState("all");
  const [loadingMore, setLoadingMore] = useState(false);
  const genRef = useRef(0);
  const { data, setData } = useApiResource<AuditListGet | null>(
    Boolean(guildId),
    signal => {
      const params = new URLSearchParams({ limit: "50", offset: "0" });
      if (section !== "all") params.set("section", section);
      return apiGet<AuditListGet>(`/api/guilds/${guildId}/audit?${params}`, { entries: [], total: 0 }, signal);
    },
    [guildId, section],
    null,
  );
  const entries = data?.entries ?? null;
  const total = data?.total ?? 0;
  // Устаревший append (сменилась гильдия/секция) не должен дописываться в новый список.
  useEffect(() => { genRef.current++; setLoadingMore(false); }, [guildId, section]);
  async function loadMore() {
    const gen = genRef.current;
    const params = new URLSearchParams({ limit: "50", offset: String(entries?.length ?? 0) });
    if (section !== "all") params.set("section", section);
    setLoadingMore(true);
    try {
      const page = await apiGet<AuditListGet>(`/api/guilds/${guildId}/audit?${params}`, { entries: [], total: 0 });
      if (gen !== genRef.current) return;
      setData(value => value ? { entries: [...value.entries, ...page.entries], total: page.total } : page);
    } finally { setLoadingMore(false); }
  }
  return <section className="panel-stack"><article className="card settings-card">
      <CardHeader title="История изменений панели" note={total ? `${total} записей` : undefined}
        muted="Кто, что и когда менял в настройках этого сервера. Хранятся последние 1000 действий."
        action={<div className="audit-filter"><label>Раздел
          <Select value={section} onChange={setSection} ariaLabel="Раздел журнала"
            options={[{ value: "all", label: "Все разделы" }, ...auditSections.map(s => ({ value: s, label: s }))]}/>
        </label></div>}/>
    </article><article className="card audit-list">{entries === null ? <p className="muted" role="status">Загружаем журнал…</p> : entries.length ? entries.map(entry => <div className="audit-item" key={entry.id}><time dateTime={new Date(entry.created_at).toISOString()}>{formatTime(entry.created_at)}</time><span className="audit-user">{entry.user_name}</span><span className="pill pill-info">{entry.section}</span><p>{entry.summary}</p></div>) : <p className="muted">Изменений ещё не было — сохраните любые настройки, и они появятся здесь.</p>}{entries && entries.length < total && <button type="button" className="btn secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Загружаем…" : `Показать ещё (${entries.length} из ${total})`}</button>}</article></section>;
}

export function ServerDataCleanup({ guildId, onDone, onError }: { guildId: string; onDone: PanelNotify; onError: PanelFail }) {
  const { busy, run } = usePanelAction({ onDone, onError });
  const [active, setActive] = useState<string | null>(null);
  const runCleanup = async (target: (typeof cleanupTargets)[number]) => {
    if (!(await confirmAction(target.confirm, "Очистить"))) return;
    setActive(target.key);
    try {
      await run(
        () => apiSend<{ removed?: number }>(`/api/guilds/${guildId}/cleanup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: target.key }) }, "Не удалось очистить данные."),
        data => {
          const removedCount = data.removed ?? 0;
          return { message: `${target.done}${removedCount ? ` Удалено записей: ${removedCount}.` : ""}${target.key === "audit" ? " Запись об очистке останется в журнале." : ""}` };
        },
      );
    } finally {
      setActive(null);
    }
  };
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
