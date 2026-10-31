"use client";

import { logGroups, logKeys } from "#lib/labels.ts";
import { fromDto, loggingDefaults, toDto, type LoggingDto } from "#contracts/logging.ts";
import { useDashboard } from "./DashboardContext.tsx";
import { useSettingsTab } from "./useSettingsTab.ts";
import { CardHeader, SaveButton, SectionLoading, channelOptions, Select, useAsyncAction } from "./ui.tsx";

export function LoggingSettings() {
  const { guildId, resources, notify, fail } = useDashboard();
  const { value, setValue, loading, save } = useSettingsTab<LoggingDto, LoggingDto>({
    endpoint: `/api/guilds/${guildId}/logging`,
    initial: loggingDefaults,
    fromGet: fromDto,
    toBody: toDto,
    saveMode: "markSaved",
    loadError: "Не удалось загрузить настройки логов.",
    saveError: "Не удалось сохранить настройки логов.",
    savedMessage: "Настройки логов сохранены.",
    registerKey: "logging",
    onDone: notify,
    onError: fail,
  });
  const { busy: saving, run } = useAsyncAction();
  if (loading) return <SectionLoading/>;
  const channels = resources?.channels ?? [];
  const channelId = value.channelId;
  const categories = value.categories;
  const enabledCount = Object.values(categories).filter(Boolean).length;
  return (
    <section className="panel-stack">
      <article className="card settings-card">
        <CardHeader title="Журнал событий" note={`включено ${enabledCount} из ${logKeys.length}`} muted="Каждое событие отправляется отдельным читаемым embed-сообщением."
          action={<SaveButton saving={saving} onClick={() => run(save)} label="Сохранить логи"/>}/>
        <label>
          Канал
          <Select value={channelId ?? ""} onChange={v => setValue({ ...value, channelId: v || null })} ariaLabel="Канал журнала"
            options={channelOptions(channels, "Выберите канал")}/>
        </label>
      </article>
      <div className="log-groups">
        {logGroups.map(group => {
          const groupEnabled = group.items.filter(([key]) => categories[key]).length;
          return (
            <article className="card log-group" key={group.title}>
              <h2>{group.title} <span className="group-note">{groupEnabled} из {group.items.length}</span></h2>
              {group.items.map(([key, label]) => (
                <div className="event-toggle" key={key}>
                  <span className="event-toggle-label" id={`log-label-${key}`}>{label}</span>
                  <label className="switch">
                    <input type="checkbox" aria-labelledby={`log-label-${key}`} checked={Boolean(categories[key])} onChange={e => setValue({ ...value, categories: { ...categories, [key]: e.target.checked } })}/>
                    <span/>
                  </label>
                </div>
              ))}
            </article>
          );
        })}
      </div>
    </section>
  );
}
