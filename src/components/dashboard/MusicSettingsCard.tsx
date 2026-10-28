"use client";

import { CardHeader, CheckList, NumberField, SaveButton, Select, channelOptions, useAsyncAction } from "./ui.tsx";
import type { Channel, Role } from "./types.ts";
import type { MusicSettings } from "../../lib/music-settings.ts";
import { formatLeaveAfter } from "../../lib/format.ts";

const leavePresets = [
  { value: 0, label: "Выкл" },
  { value: 60, label: "1 мин" },
  { value: 300, label: "5 мин" },
  { value: 900, label: "15 мин" },
] as const;

export function MusicSettingsCard({ channels, voiceChannels, roles, value, onChange, onSave }: {
  channels: Channel[];
  voiceChannels: Channel[];
  roles: Role[];
  value: MusicSettings;
  onChange: (value: MusicSettings) => void;
  onSave: () => unknown;
}) {
  const { busy: saving, run } = useAsyncAction();
  const leaveLabel = formatLeaveAfter(value.leave_after_seconds);
  return (
    <section className="panel-stack">
      <article className="card settings-card music-settings">
        <CardHeader
          title="Музыка"
          note={`автовыход: ${leaveLabel}`}
          muted="YouTube в голосовом канале: очередь, плейлисты и управление из панели."
          action={<SaveButton saving={saving} onClick={() => run(onSave)}/>}
        />
        <div className="music-settings-grid">
          <section className="music-section">
            <div>
              <span className="field-label">Команда /play</span>
              <p className="hint">Если канал не выбран, команда доступна в любом текстовом канале.</p>
            </div>
            <label>
              Канал для команды
              <Select value={value.command_channel_id ?? ""} ariaLabel="Канал для команды /play"
                onChange={channelId => onChange({ ...value, command_channel_id: channelId || null })}
                options={channelOptions(channels, "Любой канал")}/>
            </label>
            <div>
              <span className="field-label">Роли с доступом</span>
              <CheckList items={roles} selected={value.allowed_role_ids} label="Роли"
                onChange={ids => onChange({ ...value, allowed_role_ids: ids })}/>
              <p className="hint">Пусто — команда доступна только администраторам.</p>
            </div>
          </section>

          <section className="music-section">
            <div>
              <span className="field-label">Голосовые каналы</span>
              <p className="hint">Пусто — бот может подключаться к любому голосовому каналу.</p>
            </div>
            <CheckList items={voiceChannels} selected={value.voice_channel_ids} channel label="Голосовые каналы"
              onChange={ids => onChange({ ...value, voice_channel_ids: ids })}/>
          </section>

          <section className="music-section music-section-wide">
            <div>
              <span className="field-label">Плейлисты и миксы</span>
              <p className="hint">Если выключено, из плейлиста будет добавлен только первый трек.</p>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={value.playlists_enabled}
                onChange={e => onChange({ ...value, playlists_enabled: e.target.checked })}/>
              Разрешать добавление плейлистов
            </label>
            {value.playlists_enabled && (
              <div>
                <span className="field-label">Кому разрешены плейлисты</span>
                <CheckList items={roles} selected={value.playlist_role_ids} label="Роли для плейлистов"
                  onChange={ids => onChange({ ...value, playlist_role_ids: ids })}/>
                <p className="hint">Пусто — все, у кого есть доступ к /play. Администраторы могут всегда.</p>
              </div>
            )}
          </section>

          <section className="music-section music-section-wide">
            <div>
              <span className="field-label">Автовыход при бездействии</span>
              <p className="hint">Бездействие: в канале нет слушателей, играет тишина или плеер на паузе.</p>
            </div>
            <div className="music-leave-row">
              <NumberField label="Секунд" hint="(0 — выкл; 30–3600)" min={0} max={3600}
                value={value.leave_after_seconds}
                onChange={leave_after_seconds => onChange({ ...value, leave_after_seconds: Number.isFinite(leave_after_seconds) ? leave_after_seconds : value.leave_after_seconds })}/>
              <div className="music-presets" role="group" aria-label="Быстрый выбор автовыхода">
                {leavePresets.map(preset => (
                  <button type="button" key={preset.value}
                    className={value.leave_after_seconds === preset.value ? "chip active" : "chip"}
                    aria-pressed={value.leave_after_seconds === preset.value}
                    onClick={() => onChange({ ...value, leave_after_seconds: preset.value })}>
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      </article>
    </section>
  );
}
