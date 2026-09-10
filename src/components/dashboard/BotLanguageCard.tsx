"use client";

import { CardHeader, SaveButton, Select, useAsyncAction } from "./ui.tsx";

export function BotLanguageCard({ value, onChange, onSave }: { value: "ru" | "en"; onChange: (lang: "ru" | "en") => void; onSave: () => unknown }) {
  const { busy: saving, run } = useAsyncAction();
  return (
    <article className="card settings-card">
      <CardHeader title="Язык сообщений бота" muted="Служебные ответы бота на этом сервере."
        action={<SaveButton saving={saving} onClick={() => run(onSave)}/>}/>
      <Select value={value} onChange={next => onChange(next === "en" ? "en" : "ru")} disabled={saving} ariaLabel="Язык сообщений бота"
        options={[{ value: "ru", label: "Русский" }, { value: "en", label: "English" }]}/>
    </article>
  );
}
