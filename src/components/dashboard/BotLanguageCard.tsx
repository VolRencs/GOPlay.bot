"use client";

import { CardHeader, SaveButton, SectionLoading, Select, useAsyncAction } from "./ui.tsx";
import { fromDto, toDto, type LangCode, type LangDto } from "#contracts/lang.ts";
import { useDashboard } from "./DashboardContext.tsx";
import { useSettingsTab } from "./useSettingsTab.ts";

export function BotLanguageCard() {
  const { guildId, notify, fail } = useDashboard();
  const { value, setValue, loading, save } = useSettingsTab<LangDto, LangCode>({
    guildId,
    endpoint: `/api/guilds/${guildId}/lang`,
    initial: "ru",
    fromGet: fromDto,
    toBody: toDto,
    saveMode: "markSaved",
    loadError: "Не удалось загрузить язык бота.",
    saveError: "Не удалось сохранить язык бота.",
    savedMessage: "Язык сообщений бота сохранён.",
    registerKey: "lang",
    onDone: notify,
    onError: fail,
  });
  const { busy: saving, run } = useAsyncAction();
  if (loading) return <SectionLoading/>;
  return (
    <article className="card settings-card">
      <CardHeader title="Язык сообщений бота" muted="Служебные ответы бота на этом сервере."
        action={<SaveButton saving={saving} onClick={() => run(save)}/>}/>
      <Select value={value} onChange={next => setValue(next === "en" ? "en" : "ru")} disabled={saving} ariaLabel="Язык сообщений бота"
        options={[{ value: "ru", label: "Русский" }, { value: "en", label: "English" }]}/>
    </article>
  );
}
