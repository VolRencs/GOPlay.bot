"use client";
import { useRef, useState } from "react";
import NextLink from "next/link.js";
import type { ComponentProps, ComponentType } from "react";
import { ArrowRight, Check, LogOut, ShieldCheck, X } from "lucide-react";
import { authClient } from "../lib/auth-client.ts";
import { useAsyncAction, useDismissOnOutside } from "./dashboard/ui.tsx";
import type { AccountAccess } from "../lib/access.ts";

const Link = NextLink as unknown as ComponentType<ComponentProps<"a">>;

export default function UserMenu({ access }: { access: AccountAccess }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { busy, run } = useAsyncAction();

  useDismissOnOutside(root, open, () => setOpen(false));

  if (!access.authenticated) {
    return <Link className="btn secondary small" href="/login"><span>Войти</span><ArrowRight size={16} /></Link>;
  }

  async function signOut() {
    await run(async () => { try { await authClient.signOut(); } catch {  } });
    window.location.assign("/");
  }

  return <div className="user-menu" ref={root}>
    <button type="button" className="user-menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-label="Меню аккаунта" onClick={() => setOpen((value) => !value)}>
      <img className="user-menu-avatar" src={access.image || "/bot-logo.avif"} alt="" onError={event => { event.currentTarget.src = "/bot-logo.avif"; }} />
    </button>
    {open && <div className="user-menu-dropdown" role="menu">
      <div className="user-menu-header">
        <img className="user-menu-avatar large" src={access.image || "/bot-logo.avif"} alt="" onError={event => { event.currentTarget.src = "/bot-logo.avif"; }} />
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
      {access.isAdmin && <Link className="btn" href="/admin">Админ панель <ShieldCheck size={15} /></Link>}
      {access.allowed && access.canManage && <Link className="btn" href="/dashboard">Панель управления <ArrowRight size={15} /></Link>}
      <button type="button" className="btn danger" onClick={() => void signOut()} disabled={busy}>
        <LogOut size={15} />{busy ? "Выход…" : "Выйти из аккаунта"}
      </button>
    </div>}
  </div>;
}
