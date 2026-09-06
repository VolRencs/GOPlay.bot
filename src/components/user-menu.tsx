"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, LogOut, ShieldCheck, X } from "lucide-react";
import { authClient } from "../lib/auth-client.ts";
import { useAsyncAction } from "./dashboard/ui.tsx";
import type { AccountAccess } from "../lib/access.ts";

export default function UserMenu({ access }: { access: AccountAccess }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { busy, run } = useAsyncAction();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!access.authenticated) {
    return <a className="nav-dashboard" href="/login"><span>Войти</span><ArrowRight size={16} /></a>;
  }

  async function signOut() {
    await run(async () => { try { await authClient.signOut(); } catch { /* session may already be gone */ } });
    window.location.assign("/");
  }

  return <div className="user-menu" ref={root}>
    <button type="button" className="user-menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-label="Меню аккаунта" onClick={() => setOpen((value) => !value)}>
      <img className="user-menu-avatar" src={access.image || "/bot-logo.png"} alt="" />
    </button>
    {open && <div className="user-menu-dropdown" role="menu">
      <div className="user-menu-header">
        <img className="user-menu-avatar large" src={access.image || "/bot-logo.png"} alt="" />
        <div>
          <strong>{access.name}</strong>
          <code>Discord ID: {access.discordId}</code>
        </div>
      </div>
      <div className="user-menu-statuses">
        <span className={access.allowed ? "user-status ok" : "user-status bad"}>
          {access.allowed ? <Check size={14} /> : <X size={14} />}
          {access.allowed ? "Доступ к Dashboard разрешён" : "Доступ к Dashboard запрещён"}
        </span>
        <span className={access.canManage ? "user-status ok" : "user-status bad"}>
          {access.canManage ? <ShieldCheck size={14} /> : <X size={14} />}
          {access.canManage ? "Есть права на добавление и редактирование" : "Нет прав на добавление и редактирование"}
        </span>
      </div>
      {access.isAdmin && <a className="btn" href="/admin">Админ панель <ShieldCheck size={15} /></a>}
      {access.allowed && access.canManage && <a className="btn" href="/dashboard">Панель управления <ArrowRight size={15} /></a>}
      <button type="button" className="btn danger" onClick={() => void signOut()} disabled={busy}>
        <LogOut size={15} />{busy ? "Выход…" : "Выйти из аккаунта"}
      </button>
    </div>}
  </div>;
}