"use client";

import { CardHeader, SaveButton, SectionLoading, Select, useAsyncAction } from "./ui.tsx";
import type { AutoroleDto } from "#contracts/autorole.ts";
import { useDashboard } from "./DashboardContext.tsx";
import { useSettingsTab } from "./useSettingsTab.ts";

export function AutoroleSettings() {
  const { guildId, resources, notify, fail } = useDashboard();
  const { value, setValue, loading, save } = useSettingsTab<AutoroleDto, AutoroleDto>({
    endpoint: `/api/guilds/${guildId}/autorole`,
    initial: { enabled: false, roleId: null },
    fromGet: data => data,
    toBody: value => value,
    saveMode: "markSaved",
    loadError: "Не удалось загрузить автороль.",
    saveError: "Не удалось сохранить автороль.",
    savedMessage: "Автороль при входе сохранена.",
    registerKey: "autorole",
    onDone: notify,
    onError: fail,
  });
  const { busy: saving, run } = useAsyncAction();
  if (loading) return <SectionLoading/>;
  const roles = resources?.roles ?? [];
  return (
    <section className="card settings-card">
      <CardHeader title="Автороль при входе" muted="Роль, которую бот выдаёт участнику сразу после присоединения к серверу." action={<SaveButton saving={saving} disabled={saving || (value.enabled && !value.roleId)} onClick={() => run(save)} />} />
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
