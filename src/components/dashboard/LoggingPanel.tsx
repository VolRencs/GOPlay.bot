"use client";

import { logGroups, logKeys } from "../../../src/lib/labels.ts";
import type { Channel, LoggingState } from "./types.ts";
import { CardHeader, channelOptions, Select, useAsyncAction } from "./ui.tsx";

export function LoggingSettings({ channels, value, onChange, onSave }: { channels: Channel[]; value: LoggingState; onChange: (value: LoggingState) => void; onSave: () => unknown }) {
  const { busy: saving, run } = useAsyncAction();
  const channelId = value.channelId;
  const categories = value.categories;
  const enabledCount = Object.values(categories).filter(Boolean).length;
  return (
    <section className="panel-stack">
      <article className="card settings-card">
        <CardHeader title={<>Журнал событий <span className="toolbar-note">включено {enabledCount} из {logKeys.length}</span></>} muted="Каждое событие отправляется отдельным читаемым embed-сообщением."
          action={<button className="btn" disabled={saving} onClick={() => run(onSave)}>{saving ? "Сохраняем…" : "Сохранить логи"}</button>}/>
        <label>
          Канал
          <Select value={channelId} onChange={v => onChange({ ...value, channelId: v })} ariaLabel="Канал журнала"
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
                    <input type="checkbox" aria-labelledby={`log-label-${key}`} checked={Boolean(categories[key])} onChange={e => onChange({ ...value, categories: { ...categories, [key]: e.target.checked } })}/>
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
