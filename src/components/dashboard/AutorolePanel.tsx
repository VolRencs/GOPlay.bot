"use client";

import { useEffect, useState } from "react";
import { CardHeader, CheckList, SaveButton } from "./ui.tsx";
import { apiGet, apiMutate } from "./api.ts";
import { useApiResource, usePanelAction } from "./hooks.ts";
import type { AutoroleGet } from "../../lib/autorole.ts";
import type { PanelFail, PanelNotify, Role } from "./types.ts";

const fallback: AutoroleGet = { enabled: false, roleIds: [] };

export function AutoroleSettings({ guildId, roles, onDone, onError }: { guildId: string; roles: Role[]; onDone: PanelNotify; onError: PanelFail }) {
  const { data, reload } = useApiResource(Boolean(guildId), async (signal) => apiGet<AutoroleGet>(`/api/guilds/${guildId}/autorole`, fallback, signal), [guildId], fallback);
  const { busy, run } = usePanelAction({ onDone, onError });
  const [enabled, setEnabled] = useState(false);
  const [roleIds, setRoleIds] = useState<string[]>([]);

  useEffect(() => { setEnabled(data.enabled); setRoleIds(data.roleIds); }, [data]);

  async function save() {
    await run(
      () => apiMutate(`/api/guilds/${guildId}/autorole`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, roleIds }),
      }, "Не удалось сохранить автороль."),
      () => ({ message: "Автороль при входе сохранена." }),
      reload,
    );
  }

  return (
    <section className="card settings-card">
      <CardHeader title="Автороль при входе" muted="Роли, которые бот выдаёт участнику сразу после присоединения к серверу." action={<SaveButton saving={busy} onClick={() => void save()} />} />
      <label className="role-autorole-toggle">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={busy} />
        <span>Включить выдачу ролей при входе</span>
      </label>
      <CheckList items={roles} selected={roleIds} onChange={setRoleIds} label="Роли при входе" />
    </section>
  );
}
