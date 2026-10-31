"use client";

import { Trash2 } from "lucide-react";
import { MAX_LEVEL, MAX_REWARDS, xpForLevel, type NotifyMode } from "#lib/levels.ts";
import { levelDefaultsDto, levelRangesDto, normalize, type LevelRewardDto, type LevelSettingsDto, type LevelsDto } from "#contracts/levels.ts";
import { CardHeader, CheckList, NumberField, SaveButton, SectionLoading, Select, channelOptions, formatNumber, useAsyncAction } from "./ui.tsx";
import { useDashboard } from "./DashboardContext.tsx";
import { useSettingsTab } from "./useSettingsTab.ts";

const notifyOptions: { value: NotifyMode; label: string }[] = [
  { value: "channel", label: "В выбранный канал" },
  { value: "dm", label: "В личные сообщения" },
  { value: "off", label: "Не уведомлять" },
];

function nextRewardLevel(rewards: LevelRewardDto[]): number | null {
  const used = new Set(rewards.map(reward => reward.level));
  for (let level = 1; level <= MAX_LEVEL; level++) if (!used.has(level)) return level;
  return null;
}

export function LevelsPanel() {
  const { guildId, resources, notify, fail } = useDashboard();
  const { value: levels, setValue, loading, save } = useSettingsTab<LevelsDto, LevelsDto>({
    endpoint: `/api/guilds/${guildId}/levels`,
    initial: { settings: { ...levelDefaultsDto, ignoredChannelIds: [], ignoredRoleIds: [] }, rewards: [] },
    fromGet: normalize,
    toBody: normalize,
    afterSave: normalize,
    loadError: "Не удалось загрузить настройки уровней.",
    saveError: "Не удалось сохранить настройки уровней.",
    savedMessage: "Настройки уровней сохранены.",
    registerKey: "levels",
    onDone: notify,
    onError: fail,
  });
  const { busy: saving, run } = useAsyncAction();
  if (loading) return <SectionLoading/>;
  const channels = resources?.channels ?? [];
  const roles = resources?.roles ?? [];
  const value = levels.settings;
  const rewards = levels.rewards;
  const onChange = (settings: LevelSettingsDto) => setValue({ ...levels, settings });
  const onRewardsChange = (rewards: LevelRewardDto[]) => setValue({ ...levels, rewards });
  const onSave = save;
  const set = (change: Partial<LevelSettingsDto>) => onChange({ ...value, ...change });
  const needsChannel = value.notifyMode === "channel";
  const addLevel = nextRewardLevel(rewards);
  const preview = value.growthPercent === 0
    ? `У всех уровней одинаковый порог — ${formatNumber(value.baseXp)} XP.`
    : [1, 2, 3, 4].map(level => `Ур. ${level} — ${formatNumber(xpForLevel(level, value.baseXp, value.growthPercent))} XP`).join(" · ");
  return (
    <section className="panel-stack">
      <article className="card settings-card">
        <CardHeader title="Система уровней"
          muted="Опыт начисляется за сообщения и время в голосовых каналах."
          action={<SaveButton saving={saving} onClick={() => run(onSave)}/>}/>
      </article>
      <article className={value.enabled ? "card settings-card level-card" : "card settings-card level-card is-off"}>
        <CardHeader title="Настройки"
          action={<label className="switch">
            <input type="checkbox" aria-label="Включить систему уровней" checked={value.enabled} onChange={e => set({ enabled: e.target.checked })}/>
            <span/>
          </label>}/>
        <div className="level-sections">
          <section className="level-section">
            <span className="field-label">Опыт за активность</span>
            <div className="level-fields">
              <NumberField label="XP за сообщение" hint="(0 — выкл)" value={value.xpPerMessage} min={levelRangesDto.xpPerMessage.min} max={levelRangesDto.xpPerMessage.max} onChange={xpPerMessage => set({ xpPerMessage })}/>
              <NumberField label="Пауза, сек" hint="(0 — без паузы)" value={value.messageCooldownSeconds} min={levelRangesDto.messageCooldownSeconds.min} max={levelRangesDto.messageCooldownSeconds.max} onChange={messageCooldownSeconds => set({ messageCooldownSeconds })}/>
              <NumberField label="Мин. длина, символов" value={value.minMessageLength} min={levelRangesDto.minMessageLength.min} max={levelRangesDto.minMessageLength.max} onChange={minMessageLength => set({ minMessageLength })}/>
              <NumberField label="XP за минуту в голосе" hint="(0 — выкл)" value={value.xpPerVoiceMinute} min={levelRangesDto.xpPerVoiceMinute.min} max={levelRangesDto.xpPerVoiceMinute.max} onChange={xpPerVoiceMinute => set({ xpPerVoiceMinute })}/>
            </div>
          </section>
          <section className="level-section">
            <span className="field-label">Уровни</span>
            <div className="level-fields">
              <NumberField label="XP для 1 уровня" value={value.baseXp} min={levelRangesDto.baseXp.min} max={levelRangesDto.baseXp.max} onChange={baseXp => set({ baseXp })}/>
              <NumberField label="Рост порога, %" hint="(0 — одинаковый)" value={value.growthPercent} min={levelRangesDto.growthPercent.min} max={levelRangesDto.growthPercent.max} onChange={growthPercent => set({ growthPercent })}/>
            </div>
            <p className="hint level-preview">{preview}</p>
          </section>
          <section className="level-section level-wide">
            <span className="field-label">Уведомления о новом уровне</span>
            <div className="level-fields">
              <label>
                Куда отправлять
                <Select value={value.notifyMode} onChange={mode => set({ notifyMode: mode as NotifyMode })} ariaLabel="Куда отправлять уведомления об уровне"
                  options={notifyOptions}/>
              </label>
              {needsChannel && (
                <label>
                  Канал
                  <Select value={value.notifyChannelId ?? ""} onChange={channelId => set({ notifyChannelId: channelId || null })} ariaLabel="Канал уведомлений об уровне"
                    options={channelOptions(channels, "Выберите канал")}/>
                </label>
              )}
            </div>
          </section>
          <section className="level-section level-wide">
            <span className="field-label">Где опыт не начисляется</span>
            <div className="level-exclusions">
              <div>
                <span className="muted">Каналы</span>
                <CheckList items={channels} selected={value.ignoredChannelIds} channel label="Каналы" onChange={ignoredChannelIds => set({ ignoredChannelIds })}/>
                <p className="hint">Если ничего не выбрано, опыт начисляется во всех каналах.</p>
              </div>
              <div>
                <span className="muted">Роли</span>
                <CheckList items={roles} selected={value.ignoredRoleIds} label="Роли" onChange={ignoredRoleIds => set({ ignoredRoleIds })}/>
                <p className="hint">Если ничего не выбрано, опыт получают все участники.</p>
              </div>
            </div>
          </section>
          <section className="level-section level-wide">
            <span className="field-label">Роли за уровни</span>
            <p className="hint">Одна роль на уровень: при получении следующей прежняя снимается.</p>
            {rewards.length > 0 && (
              <div className="reward-rows">
                {rewards.map((reward, index) => (
                  <div className="reward-row" key={index}>
                    <input type="number" min={1} max={MAX_LEVEL} aria-label="Уровень награды" value={reward.level}
                      onChange={e => { const level = Math.max(1, Math.min(MAX_LEVEL, Number(e.target.value) || 1)); if (rewards.some((entry, n) => n !== index && entry.level === level)) return; onRewardsChange(rewards.with(index, { ...reward, level })); }}/>
                    <Select value={reward.roleId} placeholder="Выберите роль" ariaLabel={`Роль за ${reward.level} уровень`}
                      onChange={roleId => onRewardsChange(rewards.with(index, { ...reward, roleId }))}
                      options={roles.map(role => ({ value: role.id, label: role.name }))}/>
                    <button type="button" className="btn danger small icon-only" onClick={() => onRewardsChange(rewards.filter((_, n) => n !== index))} aria-label={`Удалить награду за уровень ${reward.level}`}><Trash2 size={14}/></button>
                  </div>
                ))}
              </div>
            )}
            {rewards.length < MAX_REWARDS && addLevel !== null && (
              <button type="button" className="btn secondary" disabled={!roles.length}
                onClick={() => onRewardsChange([...rewards, { level: addLevel, roleId: roles[0]?.id ?? "" }])}>Добавить награду</button>
            )}
            {!roles.length && <p className="hint">Нет ролей, которые бот может выдавать: поднимите его роль выше нужных в Discord.</p>}
          </section>
        </div>
      </article>
    </section>
  );
}
