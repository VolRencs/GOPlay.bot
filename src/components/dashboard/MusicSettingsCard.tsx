"use client";

import { CardHeader, CheckList, NumberField, SaveButton, Select, channelOptions, useAsyncAction } from "./ui.tsx";
import type { Channel, Role } from "./types.ts";
import type { MusicSettings } from "../../lib/music-settings.ts";

export function MusicSettingsCard({ channels, voiceChannels, roles, value, onChange, onSave }: {
  channels: Channel[];
  voiceChannels: Channel[];
  roles: Role[];
  value: MusicSettings;
  onChange: (value: MusicSettings) => void;
  onSave: () => unknown;
}) {
  const { busy: saving, run } = useAsyncAction();
  return (
    <section className="panel-stack">
      <article className="card settings-card">
        <CardHeader title="Музыка" muted="Воспроизведение только с YouTube. Пустой список голосовых каналов — бот может подключаться к любому. Пустой список ролей — только администраторы."
          action={<SaveButton saving={saving} onClick={() => run(onSave)}/>}/>
        <label>Канал для команды /play
          <Select value={value.command_channel_id ?? ""} ariaLabel="Канал для команды /play"
            onChange={channelId => onChange({ ...value, command_channel_id: channelId || null })}
            options={channelOptions(channels, "Любой канал")}/>
        </label>
        <div>
          <span className="field-label">Голосовые каналы для подключения (пусто — любые)</span>
          <CheckList items={voiceChannels} selected={value.voice_channel_ids} channel label="Голосовые каналы"
            onChange={ids => onChange({ ...value, voice_channel_ids: ids })}/>
        </div>
        <div>
          <span className="field-label">Роли с доступом к /play (пусто — только админы)</span>
          <CheckList items={roles} selected={value.allowed_role_ids} label="Роли"
            onChange={ids => onChange({ ...value, allowed_role_ids: ids })}/>
        </div>
        <NumberField label="Автовыход при бездействии, секунд" hint="(0 — выкл; иначе 30–3600. Бездействие: нет слушателей, тишина или пауза)" min={0} max={3600} value={value.leave_after_seconds}
          onChange={leave_after_seconds => onChange({ ...value, leave_after_seconds: leave_after_seconds || 0 })}/>
      </article>
    </section>
  );
}
