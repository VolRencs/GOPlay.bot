"use client";

import { Suspense, use, useEffect, useRef, useState, useTransition } from "react";
import { Bot } from "lucide-react";
import { Brand } from "#components/brand.tsx";
import { PageHeader } from "#components/page-header.tsx";
import { ConfirmHost, SectionError, SectionLoading } from "#components/dashboard/ui.tsx";
import { DashboardProvider, useDashboard } from "#components/dashboard/DashboardContext.tsx";
import { TAB_DEFS, TAB_GROUPS, isTabKey, type TabKey } from "#components/dashboard/tabs.tsx";
import { SERVER_FALLBACK_NAME } from "#lib/constants.ts";
import { guildIconUrl } from "#lib/format.ts";

export default function GuildSettings({ params, searchParams }: PageProps<"/dashboard/[guildId]">) {
  const { guildId } = use(params);
  const query = use(searchParams);
  const requestedTab = typeof query.tab === "string" ? query.tab : "";
  const initialTab = isTabKey(requestedTab) ? requestedTab : "stats";
  return <DashboardProvider guildId={guildId}>
    <DashboardShell key={guildId} initialTab={initialTab}/>
  </DashboardProvider>;
}

function DashboardShell({ initialTab }: { initialTab: TabKey }) {
  const { guildId, resources, resourcesError, reloadResources, loading, isDirty, saveAll, discardAll } = useDashboard();
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [, startTransition] = useTransition();
  const [savingAll, setSavingAll] = useState(false);
  const [nudgeActive, setNudgeActive] = useState(false);
  const nudgeTimer = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const server = resources?.server ?? { name: SERVER_FALLBACK_NAME, icon: null };
  const ActiveTab = TAB_DEFS[tab].component;

  function nudgeBar() {
    setNudgeActive(true);
    const bar = barRef.current;
    if (bar && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      bar.getAnimations().forEach(animation => animation.cancel());
      bar.animate([
        { transform: "translateX(-50%)" },
        { transform: "translateX(-50%) translateX(-6px)", offset: .3 },
        { transform: "translateX(-50%) translateX(6px)", offset: .65 },
        { transform: "translateX(-50%)" },
      ], { duration: 550, easing: "cubic-bezier(.36, .07, .19, .97)" });
    }
    if (nudgeTimer.current !== null) window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = window.setTimeout(() => {
      nudgeTimer.current = null;
      setNudgeActive(false);
    }, 900);
  }

  useEffect(() => () => {
    if (nudgeTimer.current !== null) window.clearTimeout(nudgeTimer.current);
  }, []);

  function switchTab(next: TabKey) {
    startTransition(() => setTab(next));
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  }

  function selectTab(next: TabKey) {
    if (next === tab) return;
    if (isDirty) nudgeBar();
    else switchTab(next);
  }

  async function saveAllFromBar() {
    if (savingAll) return;
    setSavingAll(true);
    try { await saveAll(); } finally { setSavingAll(false); }
  }

  function discardFromBar() {
    if (savingAll) return;
    discardAll();
  }

  useEffect(() => {
    if (!isDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const blockLinks = (event: MouseEvent) => {
      if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!link || link.getAttribute("target") === "_blank" || link.hasAttribute("download")) return;
      if (!event.defaultPrevented) {
        event.preventDefault();
        nudgeBar();
      }
    };
    // App Router does not fire beforeunload for browser Back/Forward. Keep a
    // sentinel entry so Back is blocked instead of dropping edits.
    const current = window.location.href;
    window.history.pushState({ goplayGuard: true }, "", current);
    const onPop = () => {
      window.history.pushState({ goplayGuard: true }, "", current);
      nudgeBar();
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", onPop);
    document.addEventListener("click", blockLinks, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", blockLinks, true);
      if ((window.history.state as { goplayGuard?: boolean } | null)?.goplayGuard) {
        window.history.replaceState(null, "", window.location.href);
      }
    };
  }, [isDirty]);

  return <main className={isDirty ? "settings-shell is-dirty" : "settings-shell"}>
    <aside className="sidebar" aria-label="Настройки сервера">
      <Brand href="/dashboard"/>
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
      <PageHeader
        back={{ href: "/dashboard", label: "Все серверы" }}
        icon={guildIconUrl(guildId, server.icon) ? <img src={guildIconUrl(guildId, server.icon)!} alt=""/> : <Bot size={24}/>}
        eyebrow={`GOPLAY · ${server.name}`}
        title={TAB_DEFS[tab].title}
        description={TAB_DEFS[tab].description}
      />
      {loading && <p className="loading" role="status">Загружаем настройки сервера…</p>}
      {resourcesError ? (
        <SectionError message={resourcesError} onRetry={reloadResources}/>
      ) : (
        <div hidden={loading}>
          <Suspense fallback={<SectionLoading/>}><ActiveTab/></Suspense>
        </div>
      )}
    </section>
    {isDirty && <div ref={barRef} className={nudgeActive ? "unsaved-float is-nudge" : "unsaved-float"} role="status">
      <span className="warn-dot" aria-hidden="true"/>
      <span>Есть несохранённые изменения</span>
      <button type="button" className="btn success" disabled={savingAll} onClick={() => void saveAllFromBar()}>{savingAll ? "Сохраняем…" : "Сохранить"}</button>
      <button type="button" className="btn secondary" disabled={savingAll} onClick={discardFromBar}>Сбросить</button>
    </div>}
    <ConfirmHost/>
  </main>;
}
