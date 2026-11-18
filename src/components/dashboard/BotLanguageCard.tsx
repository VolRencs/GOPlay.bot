"use client";

import { CardHeader, SaveButton, SectionError, SectionLoading, Select } from "./ui.tsx";
import type { LangCode, LangDto } from "#contracts/dashboard.ts";
import { useSettingsTab } from "./useSettingsTab.ts";

export function BotLanguageCard() {
  const { value, setValue, loading, loadError, reload, saving, saveNow } = useSettingsTab<LangDto, LangCode>({
    initial: "ru",
    fromGet: data => data.lang,
    toBody: lang => ({ lang }),
    saveMode: "markSaved",
    loadError: "Не удалось загрузить язык бота.",
    saveError: "Не удалось сохранить язык бота.",
    savedMessage: "Язык сообщений бота сохранён.",
    settingsKey: "lang",
  });
  if (loading) return <SectionLoading/>;
  if (loadError) return <SectionError message={loadError} onRetry={reload}/>;
  return (
    <article className="card settings-card">
      <CardHeader title="Язык сообщений бота" muted="Служебные ответы бота на этом сервере."
        action={<SaveButton saving={saving} onClick={saveNow}/>}/>
      <Select value={value} onChange={next => setValue(next === "en" ? "en" : "ru")} disabled={saving} ariaLabel="Язык сообщений бота"
        options={[{ value: "ru", label: "Русский" }, { value: "en", label: "English" }]}/>
    </article>
  );
}
