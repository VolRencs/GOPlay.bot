"use client";

import { CardHeader, SaveButton, SectionLoading, Select } from "./ui.tsx";
import { fromLangDto, toLangDto, type LangCode, type LangDto } from "#contracts/dashboard.ts";
import { useSettingsTab } from "./useSettingsTab.ts";

export function BotLanguageCard() {
  const { value, setValue, loading, saving, saveNow } = useSettingsTab<LangDto, LangCode>({
    initial: "ru",
    fromGet: fromLangDto,
    toBody: toLangDto,
    saveMode: "markSaved",
    loadError: "Не удалось загрузить язык бота.",
    saveError: "Не удалось сохранить язык бота.",
    savedMessage: "Язык сообщений бота сохранён.",
    settingsKey: "lang",
  });
  if (loading) return <SectionLoading/>;
  return (
    <article className="card settings-card">
      <CardHeader title="Язык сообщений бота" muted="Служебные ответы бота на этом сервере."
        action={<SaveButton saving={saving} onClick={saveNow}/>}/>
      <Select value={value} onChange={next => setValue(next === "en" ? "en" : "ru")} disabled={saving} ariaLabel="Язык сообщений бота"
        options={[{ value: "ru", label: "Русский" }, { value: "en", label: "English" }]}/>
    </article>
  );
}
