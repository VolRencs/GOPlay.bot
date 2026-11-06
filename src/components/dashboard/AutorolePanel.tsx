"use client";

import { CardHeader, SaveButton, SectionLoading, Select } from "./ui.tsx";
import type { AutoroleDto } from "#contracts/roles.ts";
import { useDashboard } from "./DashboardContext.tsx";
import { useSettingsTab } from "./useSettingsTab.ts";

export function AutoroleSettings() {
  const { resources } = useDashboard();
  const { value, setValue, loading, saving, saveNow } = useSettingsTab<AutoroleDto, AutoroleDto>({
    initial: { enabled: false, roleId: null },
    fromGet: data => data,
    toBody: value => value,
    saveMode: "markSaved",
    loadError: "Не удалось загрузить автороль.",
    saveError: "Не удалось сохранить автороль.",
    savedMessage: "Автороль при входе сохранена.",
    settingsKey: "autorole",
  });
  if (loading) return <SectionLoading/>;
  const roles = resources?.roles ?? [];
  return (
    <section className="card settings-card">
      <CardHeader title="Автороль при входе" muted="Роль, которую бот выдаёт участнику сразу после присоединения к серверу." action={<SaveButton saving={saving} disabled={saving || (value.enabled && !value.roleId)} onClick={saveNow} />} />
      <label className="check-row">
        <input type="checkbox" checked={value.enabled} onChange={e => setValue({ ...value, enabled: e.target.checked })} disabled={saving} />
        <span>Выдавать роль при входе</span>
      </label>
      {value.enabled && (
        <label>
          Роль
          <Select
            value={value.roleId ?? ""}
            onChange={roleId => setValue({ ...value, roleId: roleId || null })}
            disabled={saving}
            ariaLabel="Роль при входе"
            placeholder="Выберите роль"
            options={[{ value: "", label: "Не выбрана" }, ...roles.map(role => ({ value: role.id, label: role.name }))]}
          />
        </label>
      )}
    </section>
  );
}
