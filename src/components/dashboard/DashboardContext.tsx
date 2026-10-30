"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { apiSend } from "./api.ts";
import type { PanelFail, PanelNotify, ResourcesGet } from "./types.ts";

type ChangeEntry = { dirty: boolean; save: (report?: boolean) => Promise<boolean>; discard: () => void };
type ChangeRef = { current: ChangeEntry };

type Toast = { id: number; text: string; tone: "ok" | "warn" | "error" };

type DashboardContextValue = {
  guildId: string;
  resources: ResourcesGet | null;
  loading: boolean;
  notify: PanelNotify;
  fail: PanelFail;
  isDirty: boolean;
  saveAll: () => Promise<boolean>;
  discardAll: () => void;
  registerChanges: (key: string, ref: ChangeRef) => () => void;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

let toastSeq = 0;

export function DashboardProvider({ guildId, children }: { guildId: string; children: React.ReactNode }) {
  const [resources, setResources] = useState<ResourcesGet | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: number) => {
    setToasts(list => list.filter(item => item.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) { clearTimeout(timer); toastTimers.current.delete(id); }
  }, []);

  const pushToast = useCallback((text: string, tone: Toast["tone"]) => {
    if (!text) return;
    const id = ++toastSeq;
    setToasts(list => [...list.slice(-3), { id, text, tone }]);
    if (tone !== "error") {
      const timer = setTimeout(() => dismissToast(id), tone === "warn" ? 8000 : 4500);
      toastTimers.current.set(id, timer);
    }
  }, [dismissToast]);

  useEffect(() => () => { for (const timer of toastTimers.current.values()) clearTimeout(timer); }, []);

  const notify = useCallback<PanelNotify>((message, tone) => pushToast(message, tone ?? "ok"), [pushToast]);
  const fail = useCallback<PanelFail>(message => pushToast(message, "error"), [pushToast]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void apiSend<ResourcesGet>(`/api/guilds/${guildId}/resources`, {}, "Не удалось загрузить настройки. Проверьте вход в Discord и доступ бота к серверу.").then(result => {
      if (!active) return;
      if (result.ok) setResources(result.data);
      else fail(result.error);
      setLoading(false);
    });
    return () => { active = false; };
  }, [guildId, fail]);

  const changes = useRef(new Map<string, ChangeRef>());
  const [changeVersion, setChangeVersion] = useState(0);
  const bumpChanges = useCallback(() => setChangeVersion(value => value + 1), []);
  const registerChanges = useCallback((key: string, ref: ChangeRef) => {
    changes.current.set(key, ref);
    bumpChanges();
    return () => { changes.current.delete(key); bumpChanges(); };
  }, [bumpChanges]);
  const isDirty = useMemo(() => [...changes.current.values()].some(ref => ref.current.dirty), [changeVersion]);
  const saveAll = useCallback(async () => {
    let ok = true;
    let hadDirty = false;
    for (const ref of [...changes.current.values()]) {
      const entry = ref.current;
      if (!entry.dirty) continue;
      hadDirty = true;
      ok = await entry.save(false) && ok;
    }
    bumpChanges();
    if (ok && hadDirty) notify("Все изменения сохранены.");
    return ok;
  }, [bumpChanges, notify]);
  const discardAll = useCallback(() => {
    for (const ref of [...changes.current.values()]) ref.current.discard();
    bumpChanges();
  }, [bumpChanges]);

  const value = useMemo<DashboardContextValue>(() => ({
    guildId, resources, loading, notify, fail, isDirty, saveAll, discardAll, registerChanges,
  }), [guildId, resources, loading, notify, fail, isDirty, saveAll, discardAll, registerChanges]);

  return <DashboardContext.Provider value={value}>
    {children}
    <div className="toast-stack" role="region" aria-label="Уведомления">
      {toasts.map(toast => <div key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}><span className="toast-dot" aria-hidden="true"/><span className="toast-text">{toast.text}</span><button type="button" className="toast-close" aria-label="Закрыть уведомление" onClick={() => dismissToast(toast.id)}><X size={14}/></button></div>)}
    </div>
  </DashboardContext.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("useDashboard must be used inside DashboardProvider");
  return value;
}

export function useRegisterChanges(key: string, entry: ChangeEntry): void {
  const { registerChanges } = useDashboard();
  const ref = useRef(entry);
  ref.current = entry;
  useEffect(() => registerChanges(key, ref), [key, registerChanges, entry.dirty]);
}
