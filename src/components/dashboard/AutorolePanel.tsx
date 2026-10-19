"use client";

import { CardHeader, SaveButton, Select, useAsyncAction } from "./ui.tsx";
import type { AutoroleGet } from "../../lib/autorole.ts";
import type { Role } from "./types.ts";

export function AutoroleSettings({ roles, value, onChange, onSave }: {
  roles: Role[];
  value: AutoroleGet;
  onChange: (value: AutoroleGet) => void;
  onSave: () => unknown;
}) {
  const { busy: saving, run } = useAsyncAction();
  return (
    <section className="card settings-card">
      <CardHeader title="Автороль при входе" muted="Роль, которую бот выдаёт участнику сразу после присоединения к серверу." action={<SaveButton saving={saving} disabled={saving || (value.enabled && !value.roleId)} onClick={() => run(onSave)} />} />
      <label className="check-row">
        <input type="checkbox" checked={value.enabled} onChange={e => onChange({ ...value, enabled: e.target.checked })} disabled={saving} />
        <span>Выдавать роль при входе</span>
      </label>
      {value.enabled && (
        <label>
          Роль
          <Select
            value={value.roleId ?? ""}
            onChange={roleId => onChange({ ...value, roleId: roleId || null })}
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
