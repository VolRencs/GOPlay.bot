"use client";

import { useEffect } from "react";
import { CardHeader, SaveButton, Select } from "./ui.tsx";
import { apiGet, apiMutate } from "./api.ts";
import { useApiResource, usePanelAction } from "./hooks.ts";
import { useConfigDraft } from "./hooks.ts";
import type { AutoroleGet } from "../../lib/autorole.ts";
import type { PanelFail, PanelNotify, Role } from "./types.ts";

const fallback: AutoroleGet = { enabled: false, roleId: null };

export function AutoroleSettings({ guildId, roles, onDone, onError }: { guildId: string; roles: Role[]; onDone: PanelNotify; onError: PanelFail }) {
  const { data } = useApiResource(Boolean(guildId), async (signal) => apiGet<AutoroleGet>(`/api/guilds/${guildId}/autorole`, fallback, signal), [guildId], fallback);
  const draft = useConfigDraft<AutoroleGet>(fallback);
  const { busy, run } = usePanelAction({ onDone, onError });

  useEffect(() => {
    if (!draft.dirty) draft.commit(data);
  }, [data, draft]);

  const value = draft.value;
  const setEnabled = (enabled: boolean) => draft.setValue(current => ({ ...current, enabled }));
  const setRoleId = (roleId: string | null) => draft.setValue(current => ({ ...current, roleId }));

  async function save() {
    await run(
      () => apiMutate(`/api/guilds/${guildId}/autorole`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: value.enabled, roleId: value.roleId }),
      }, "Не удалось сохранить автороль."),
      (result) => {
        const unchanged = Boolean((result as unknown as { unchanged?: boolean }).unchanged);
        if (!unchanged) draft.markSaved(value);
        return { message: unchanged ? "Изменений нет." : "Автороль при входе сохранена." };
      },
    );
  }

  return (
    <section className="card settings-card">
      <CardHeader title="Автороль при входе" muted="Роль, которую бот выдаёт участнику сразу после присоединения к серверу." action={<SaveButton saving={busy} disabled={busy || (value.enabled && !value.roleId)} onClick={() => void save()} />} />
      <label className="check-row">
        <input type="checkbox" checked={value.enabled} onChange={e => setEnabled(e.target.checked)} disabled={busy} />
        <span>Выдавать роль при входе</span>
      </label>
      {value.enabled && (
        <label>
          Роль
          <Select
            value={value.roleId ?? ""}
            onChange={roleId => setRoleId(roleId || null)}
            disabled={busy}
            ariaLabel="Роль при входе"
            placeholder="Выберите роль"
            options={[{ value: "", label: "Не выбрана" }, ...roles.map(role => ({ value: role.id, label: role.name }))]}
          />
        </label>
      )}
    </section>
  );
}