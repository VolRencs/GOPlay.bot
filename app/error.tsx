"use client";

import { RotateCcw } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="container page">
    <article className="card empty-state not-found-card" role="alert">
      <span className="tile"><RotateCcw size={20}/></span>
      <h1>Что-то пошло не так</h1>
      <p>Не удалось открыть страницу. Попробуйте обновить её — данные и настройки не пострадали.</p>
      <button type="button" className="btn" onClick={reset}>Попробовать снова</button>
    </article>
  </main>;
}
