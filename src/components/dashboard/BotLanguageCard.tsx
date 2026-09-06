"use client";

import { CardHeader, Select, useAsyncAction } from "./ui.tsx";

export function BotLanguageCard({ value, onChange, onSave }: { value: "ru" | "en"; onChange: (lang: "ru" | "en") => void; onSave: () => unknown }) {
  const { busy: saving, run } = useAsyncAction();
  return (
    <article className="card settings-card">
      <CardHeader title="Язык сообщений бота" muted="Служебные ответы бота на этом сервере."
        action={<button type="button" className="btn" disabled={saving} onClick={() => run(onSave)}>{saving ? "Сохраняем…" : "Сохранить"}</button>}/>
      <Select value={value} onChange={next => onChange(next === "en" ? "en" : "ru")} disabled={saving} ariaLabel="Язык сообщений бота"
        options={[{ value: "ru", label: "Русский" }, { value: "en", label: "English" }]}/>
    </article>
  );
}
