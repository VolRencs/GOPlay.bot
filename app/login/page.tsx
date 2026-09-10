"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { authClient } from "../../src/lib/auth-client.ts";
import { useAsyncAction } from "../../src/components/dashboard/ui.tsx";

export default function Login() {
  const { busy, run } = useAsyncAction();
  const [error, setError] = useState("");
  async function signIn() {
    setError("");
    await run(async () => {
      const result = await authClient.signIn.social({ provider: "discord", callbackURL: "/dashboard", scopes: ["identify", "guilds"] });
      if (result.error) setError("Не удалось начать вход через Discord.");
    });
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <a className="landing-brand" href="/"><img src="/bot-logo.png" alt="GOPlay"/><span>GOPlay</span></a>
        <span className="feature-icon"><ShieldCheck size={24}/></span>
        <h1>Вход в Dashboard</h1>
        <p className="muted">Авторизуйтесь через Discord, чтобы настроить серверы, которыми вы управляете.</p>
        {error && <p className="error-note" role="alert">⚠ {error}</p>}
        <button type="button" className="btn" disabled={busy} onClick={signIn}>{busy ? "Открываем Discord…" : "Продолжить с Discord"}</button>
      </section>
    </main>
  );
}
