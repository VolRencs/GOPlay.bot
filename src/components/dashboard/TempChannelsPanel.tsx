"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { defaultTempConfig, type Channel, type TempChannelConfig, type TempChannelsState, type TempPreset } from "./types.ts";
import { CardHeader, CheckList, confirmAction, Select, stableStringify, TemplateLibrary, useAsyncAction } from "./ui.tsx";

function TempChannelConfigForm({ categories, value, onChange }: { categories: Channel[]; value: TempChannelConfig; onChange: (value: TempChannelConfig) => void }) {
  return (
    <>
      <label>Категория создания<Select value={value.categoryId ?? ""} onChange={v => onChange({ ...value, categoryId: v || null })} ariaLabel="Категория создания"
        options={[{ value: "", label: "Без категории" }, ...categories.map(c => ({ value: c.id, label: c.name }))]}/></label>
      <label>Шаблон названия<input value={value.nameTemplate} maxLength={100} onChange={e => onChange({ ...value, nameTemplate: e.target.value })}/></label>
      <p className="hint">Переменные: <code>{"{username}"}</code>, <code>{"{displayName}"}</code>, <code>{"{user}"}</code>.</p>
      <label>Лимит участников (0 — без лимита)<input type="number" min="0" max="99" value={value.userLimit} onChange={e => onChange({ ...value, userLimit: Math.max(0, Math.min(99, Number(e.target.value) || 0)) })}/></label>
      <label className="check-row"><input type="checkbox" checked={value.canRename} onChange={e => onChange({ ...value, canRename: e.target.checked })}/> Владелец может переименовывать канал</label>
      <label className="check-row"><input type="checkbox" checked={value.canManageAccess} onChange={e => onChange({ ...value, canManageAccess: e.target.checked })}/> Владелец может управлять доступом и передавать владение</label>
      <label className="check-row"><input type="checkbox" checked={value.canClose} onChange={e => onChange({ ...value, canClose: e.target.checked })}/> Владелец может закрывать и открывать канал</label>
    </>
  );
}

const channelLabel = (count: number) => count === 1 ? "1 канал" : count >= 2 && count <= 4 ? `${count} канала` : `${count} каналов`;

export function TemporaryChannelsSettings({ voiceChannels, categories, value, saved, onChange, onSave }: { voiceChannels: Channel[]; categories: Channel[]; value: TempChannelsState; saved: TempChannelsState | null; onChange: (value: TempChannelsState) => void; onSave: () => unknown }) {
  const { busy: saving, run } = useAsyncAction();
  const [editingId, setEditingId] = useState<number | null>(null);
  const editing = value.presets.find(p => p.id === editingId) ?? null;
  const changed = saved !== null && stableStringify(saved) !== stableStringify(value);

  const update = (change: Partial<TempPreset>) => onChange({ ...value, presets: value.presets.map(p => p.id === editingId ? { ...p, ...change } : p) });
  const newPreset = () => {
    const id = Math.min(0, ...value.presets.map(p => p.id)) - 1;
    onChange({ ...value, presets: [...value.presets, { id, name: "", triggerChannelIds: [], config: { ...defaultTempConfig } }] });
    setEditingId(id);
  };
  const removePreset = async (preset: TempPreset) => {
    if (!(await confirmAction(`Удалить шаблон «${preset.name || "без названия"}» из настроек? Действие применится после сохранения.`, "Убрать"))) return;
    onChange({ ...value, presets: value.presets.filter(p => p.id !== preset.id) });
    if (editingId === preset.id) setEditingId(null);
  };

  return (
    <section className="panel-stack">
      <TemplateLibrary
        title="Сохранённые шаблоны"
        note={value.presets.length ? String(value.presets.length) : undefined}
        description="Каждый шаблон — свой набор каналов-триггеров и настроек. Сохранённый шаблон можно изменить позже, а новый — создать в любой момент."
        empty="Сохранённых шаблонов пока нет."
      >
        {value.presets.length > 0 ? (
          <div className="template-list">
            {value.presets.map(preset => (
              <article className="template-item" key={preset.id}>
                <div>
                  <strong>{preset.name || "Без названия"}</strong>
                  <p className="muted">{preset.triggerChannelIds.length ? `${channelLabel(preset.triggerChannelIds.length)} · ${preset.config.nameTemplate}` : "Каналы не выбраны"}</p>
                </div>
                <div className="template-actions">
                  <button type="button" className="btn secondary" onClick={() => setEditingId(preset.id)}>Изменить</button>
                  <button type="button" className="btn danger" onClick={() => void removePreset(preset)} aria-label={`Удалить ${preset.name || "шаблон"}`}><Trash2 size={16}/>Удалить</button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </TemplateLibrary>
      <article className="card settings-card">
        <CardHeader title={editing ? `Шаблон «${editing.name || "без названия"}»` : "Новый шаблон"}
          muted="Выберите каналы-триггеры и настройте их, затем сохраните — шаблон появится в списке выше."
          action={<div className="template-actions">
            <button type="button" className="btn secondary" onClick={newPreset}>Новый шаблон</button>
            {(editing || changed) && (
              <button type="button" className="btn" disabled={saving} onClick={() => run(onSave)}>{saving ? "Сохраняем…" : "Сохранить настройки"}</button>
            )}
          </div>}/>
        {editing ? (
          <>
            <label>Название шаблона<input value={editing.name} maxLength={100} onChange={e => update({ name: e.target.value })}/></label>
            <div>
              <span className="field-label">Голосовые каналы-триггеры</span>
              <CheckList channel items={voiceChannels} selected={editing.triggerChannelIds} onChange={ids => update({ triggerChannelIds: ids })} label={`Каналы-триггеры шаблона «${editing.name || "без названия"}»`}/>
              <span className="hint">Можно выбрать несколько. При входе в любой из них будет создан временный канал.</span>
            </div>
            <TempChannelConfigForm categories={categories} value={editing.config} onChange={config => update({ config })}/>
          </>
        ) : (
          <p className="muted">Нажмите «Новый шаблон», чтобы выбрать каналы и настроить их, или «Изменить» у сохранённого шаблона выше.</p>
        )}
      </article>
    </section>
  );
}
