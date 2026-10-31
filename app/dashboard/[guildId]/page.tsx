"use client";

import { Suspense, use, useEffect, useState, useTransition } from "react";
import { Bot } from "lucide-react";
import { ConfirmHost, ModalShell, SectionLoading } from "#components/dashboard/ui.tsx";
import { DashboardProvider, useDashboard } from "#components/dashboard/DashboardContext.tsx";
import { TAB_DEFS, TAB_GROUPS, isTabKey, type TabKey } from "#components/dashboard/tabs.tsx";
import { SERVER_FALLBACK_NAME } from "#lib/constants.ts";

type PendingNav = { tab: TabKey } | { href: string };

export default function GuildSettings({ params }: PageProps<"/dashboard/[guildId]">) {
  const { guildId } = use(params);
  return <DashboardProvider guildId={guildId}>
    <DashboardShell key={guildId}/>
  </DashboardProvider>;
}

function DashboardShell() {
  const { guildId, resources, loading, isDirty, saveAll, discardAll } = useDashboard();
  const [tab, setTab] = useState<TabKey>("stats");
  const [, startTransition] = useTransition();
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const server = resources?.server ?? { name: SERVER_FALLBACK_NAME, icon: null };
  const ActiveTab = TAB_DEFS[tab].component;

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("tab");
    if (value && isTabKey(value)) setTab(value);
  }, []);

  function switchTab(next: TabKey) {
    startTransition(() => setTab(next));
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  }

  function selectTab(next: TabKey) {
    if (next === tab) return;
    if (isDirty) setPendingNav({ tab: next });
    else switchTab(next);
  }

  async function saveAllFromBar() {
    if (savingAll) return;
    setSavingAll(true);
    try { await saveAll(); } finally { setSavingAll(false); }
  }

  function applyNav(nav: PendingNav) {
    if ("tab" in nav) switchTab(nav.tab);
    else window.location.href = nav.href;
    setPendingNav(null);
  }

  async function saveAndGo() {
    if (!pendingNav) return;
    const ok = await saveAll();
    if (ok) applyNav(pendingNav);
    else setPendingNav(null);
  }

  function discardAndGo() {
    if (!pendingNav) return;
    discardAll();
    applyNav(pendingNav);
  }

  useEffect(() => {
    if (!isDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const blockLinks = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (link && !event.defaultPrevented && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setPendingNav({ href: link.getAttribute("href") ?? "/" });
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", blockLinks, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", blockLinks, true); };
  }, [isDirty]);

  return <main className={isDirty ? "settings-shell is-dirty" : "settings-shell"}>
    <aside className="sidebar" aria-label="Настройки сервера">
      <a href="/dashboard" className="brand"><Bot size={22}/> GOPlay</a>
      <label className="mobile-section-picker">
        <span className="mobile-section-picker-label">Раздел</span>
        <span className="mobile-section-select">
          <select value={tab} onChange={event => { if (isTabKey(event.target.value)) selectTab(event.target.value); }} aria-label="Раздел настроек">
            {TAB_GROUPS.map(group => <optgroup label={group.label} key={group.label}>
              {group.keys.map(key => <option value={key} key={key}>{TAB_DEFS[key].nav}</option>)}
            </optgroup>)}
          </select>
        </span>
      </label>
      <div className="sidebar-groups">
        {TAB_GROUPS.map(group => (
          <section className="sidebar-group" key={group.label}>
            <p className="sidebar-group-label">{group.label}</p>
            <div className="sidebar-group-items">
              {group.keys.map(key => {
                const Icon = TAB_DEFS[key].icon;
                return <button type="button" key={key} className={tab === key ? "nav-item active" : "nav-item"} aria-current={tab === key ? "page" : undefined} onClick={() => selectTab(key)}>
                  <Icon size={18}/>{TAB_DEFS[key].nav}
                </button>;
              })}
            </div>
          </section>
        ))}
      </div>
    </aside>
    <section className="settings-content">
      <header className="settings-top">
        <a className="back-link" href="/dashboard">← Все серверы</a>
        <div className="server-heading">
          <div className="server-heading-icon">{server.icon ? <img src={`https://cdn.discordapp.com/icons/${guildId}/${server.icon}.png?size=128`} alt=""/> : <Bot size={24}/>}</div>
          <div className="server-heading-copy">
            <p className="eyebrow">GOPLAY · {server.name}</p>
            <h1>{TAB_DEFS[tab].title}</h1>
            <p className="page-description">{TAB_DEFS[tab].description}</p>
          </div>
        </div>
      </header>
      {loading && <p className="loading" role="status">Загружаем настройки сервера…</p>}
      {!loading && <Suspense fallback={<SectionLoading/>}><ActiveTab/></Suspense>}
    </section>
    {pendingNav && <ConfirmNavigationDialog onSave={() => void saveAndGo()} onDiscard={discardAndGo} onCancel={() => setPendingNav(null)}/>}
    {isDirty && <div className="unsaved-float" role="status">
      <span className="warn-dot" aria-hidden="true"/>
      <span>Есть несохранённые изменения</span>
      <button type="button" className="btn" disabled={savingAll} onClick={() => void saveAllFromBar()}>{savingAll ? "Сохраняем…" : "Сохранить"}</button>
      <button type="button" className="btn secondary" disabled={savingAll} onClick={discardAll}>Сбросить</button>
    </div>}
    <ConfirmHost/>
  </main>;
}

function ConfirmNavigationDialog({ onSave, onDiscard, onCancel }: { onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  return <ModalShell labelledBy="unsaved-modal-title" onClose={onCancel}>
    <h2 id="unsaved-modal-title">Несохранённые изменения</h2>
    <p className="muted">В текущем разделе есть несохранённые изменения. Сохраните их или сбросьте перед переходом, чтобы ничего не потерять.</p>
    <div className="modal-actions">
      <button type="button" className="btn" onClick={onSave}>Сохранить изменения и перейти</button>
      <button type="button" className="btn secondary" onClick={onDiscard}>Сбросить изменения и перейти</button>
      <button type="button" data-autofocus className="btn secondary" onClick={onCancel}>Отмена</button>
    </div>
  </ModalShell>;
}
