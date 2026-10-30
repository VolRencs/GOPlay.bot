"use client";

import { CardHeader, CheckList, NumberField, SaveButton, SectionLoading, Select, channelOptions, useAsyncAction } from "./ui.tsx";
import { musicDefaults, normalize, type MusicDto } from "#contracts/music.ts";
import { formatLeaveAfter } from "#lib/format.ts";
import { useDashboard } from "./DashboardContext.tsx";
import { useSettingsTab } from "./useSettingsTab.ts";

const leavePresets = [
  { value: 0, label: "Выкл" },
  { value: 60, label: "1 мин" },
  { value: 300, label: "5 мин" },
  { value: 900, label: "15 мин" },
] as const;

export function MusicSettingsCard() {
  const { guildId, resources, notify, fail } = useDashboard();
  const { value, setValue, loading, save } = useSettingsTab<MusicDto, MusicDto>({
    guildId,
    endpoint: `/api/guilds/${guildId}/music`,
    initial: musicDefaults,
    fromGet: normalize,
    toBody: normalize,
    afterSave: normalize,
    loadError: "Не удалось загрузить настройки музыки.",
    saveError: "Не удалось сохранить настройки музыки.",
    savedMessage: "Настройки музыки сохранены.",
    registerKey: "music",
    onDone: notify,
    onError: fail,
  });
  const { busy: saving, run } = useAsyncAction();
  if (loading) return <SectionLoading/>;
  const channels = resources?.channels ?? [];
  const voiceChannels = resources?.voiceChannels ?? [];
  const roles = resources?.roles ?? [];
  const leaveLabel = formatLeaveAfter(value.leaveAfterSeconds);
  return (
    <section className="panel-stack">
      <article className="card settings-card music-settings">
        <CardHeader
          title="Музыка"
          note={`автовыход: ${leaveLabel}`}
          muted="YouTube в голосовом канале: очередь, плейлисты и управление из панели."
          action={<SaveButton saving={saving} onClick={() => run(save)}/>}
        />
        <div className="music-settings-grid">
          <section className="music-section">
            <div>
              <span className="field-label">Команда /play</span>
              <p className="hint">Если канал не выбран, команда доступна в любом текстовом канале.</p>
            </div>
            <label>
              Канал для команды
              <Select value={value.commandChannelId ?? ""} ariaLabel="Канал для команды /play"
                onChange={channelId => setValue({ ...value, commandChannelId: channelId || null })}
                options={channelOptions(channels, "Любой канал")}/>
            </label>
            <div>
              <span className="field-label">Роли с доступом</span>
              <CheckList items={roles} selected={value.allowedRoleIds} label="Роли"
                onChange={ids => setValue({ ...value, allowedRoleIds: ids })}/>
              <p className="hint">Пусто — команда доступна только администраторам.</p>
            </div>
          </section>

          <section className="music-section">
            <div>
              <span className="field-label">Голосовые каналы</span>
              <p className="hint">Пусто — бот может подключаться к любому голосовому каналу.</p>
            </div>
            <CheckList items={voiceChannels} selected={value.voiceChannelIds} channel label="Голосовые каналы"
              onChange={ids => setValue({ ...value, voiceChannelIds: ids })}/>
          </section>

          <section className="music-section music-section-wide">
            <div>
              <span className="field-label">Плейлисты и миксы</span>
              <p className="hint">Если выключено, из плейлиста будет добавлен только первый трек.</p>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={value.playlistsEnabled}
                onChange={e => setValue({ ...value, playlistsEnabled: e.target.checked })}/>
              Разрешать добавление плейлистов
            </label>
            {value.playlistsEnabled && (
              <div>
                <span className="field-label">Кому разрешены плейлисты</span>
                <CheckList items={roles} selected={value.playlistRoleIds} label="Роли для плейлистов"
                  onChange={ids => setValue({ ...value, playlistRoleIds: ids })}/>
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
                value={value.leaveAfterSeconds}
                onChange={leaveAfterSeconds => setValue({ ...value, leaveAfterSeconds: Number.isFinite(leaveAfterSeconds) ? leaveAfterSeconds : value.leaveAfterSeconds })}/>
              <div className="music-presets" role="group" aria-label="Быстрый выбор автовыхода">
                {leavePresets.map(preset => (
                  <button type="button" key={preset.value}
                    className={value.leaveAfterSeconds === preset.value ? "chip active" : "chip"}
                    aria-pressed={value.leaveAfterSeconds === preset.value}
                    onClick={() => setValue({ ...value, leaveAfterSeconds: preset.value })}>
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
