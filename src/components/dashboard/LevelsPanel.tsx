"use client";

import { Trash2 } from "lucide-react";
import { MAX_LEVEL, MAX_REWARDS, levelRanges, xpForLevel, type LevelReward, type LevelSettings, type NotifyMode } from "../../lib/levels.ts";
import type { Channel, Role } from "./types.ts";
import { CardHeader, CheckList, NumberField, SaveButton, Select, channelOptions, formatNumber, useAsyncAction } from "./ui.tsx";

const notifyOptions: { value: NotifyMode; label: string }[] = [
  { value: "channel", label: "В выбранный канал" },
  { value: "dm", label: "В личные сообщения" },
  { value: "off", label: "Не уведомлять" },
];

function nextRewardLevel(rewards: LevelReward[]): number | null {
  const used = new Set(rewards.map(reward => reward.level));
  for (let level = 1; level <= MAX_LEVEL; level++) if (!used.has(level)) return level;
  return null;
}

export function LevelsPanel({ channels, roles, value, rewards, onChange, onRewardsChange, onSave }: {
  channels: Channel[];
  roles: Role[];
  value: LevelSettings;
  rewards: LevelReward[];
  onChange: (value: LevelSettings) => void;
  onRewardsChange: (rewards: LevelReward[]) => void;
  onSave: () => unknown;
}) {
  const { busy: saving, run } = useAsyncAction();
  const set = (change: Partial<LevelSettings>) => onChange({ ...value, ...change });
  const needsChannel = value.notify_mode === "channel";
  const addLevel = nextRewardLevel(rewards);
  const preview = value.growth_percent === 0
    ? `У всех уровней одинаковый порог — ${formatNumber(value.base_xp)} XP.`
    : [1, 2, 3, 4].map(level => `Ур. ${level} — ${formatNumber(xpForLevel(level, value.base_xp, value.growth_percent))} XP`).join(" · ");
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
              <NumberField label="XP за сообщение" hint="(0 — выкл)" value={value.xp_per_message} min={levelRanges.xp_per_message.min} max={levelRanges.xp_per_message.max} onChange={xp_per_message => set({ xp_per_message })}/>
              <NumberField label="Пауза, сек" hint="(0 — без паузы)" value={value.message_cooldown_seconds} min={levelRanges.message_cooldown_seconds.min} max={levelRanges.message_cooldown_seconds.max} onChange={message_cooldown_seconds => set({ message_cooldown_seconds })}/>
              <NumberField label="Мин. длина, символов" value={value.min_message_length} min={levelRanges.min_message_length.min} max={levelRanges.min_message_length.max} onChange={min_message_length => set({ min_message_length })}/>
              <NumberField label="XP за минуту в голосе" hint="(0 — выкл)" value={value.xp_per_voice_minute} min={levelRanges.xp_per_voice_minute.min} max={levelRanges.xp_per_voice_minute.max} onChange={xp_per_voice_minute => set({ xp_per_voice_minute })}/>
            </div>
          </section>
          <section className="level-section">
            <span className="field-label">Уровни</span>
            <div className="level-fields">
              <NumberField label="XP для 1 уровня" value={value.base_xp} min={levelRanges.base_xp.min} max={levelRanges.base_xp.max} onChange={base_xp => set({ base_xp })}/>
              <NumberField label="Рост порога, %" hint="(0 — одинаковый)" value={value.growth_percent} min={levelRanges.growth_percent.min} max={levelRanges.growth_percent.max} onChange={growth_percent => set({ growth_percent })}/>
            </div>
            <p className="hint level-preview">{preview}</p>
          </section>
          <section className="level-section level-wide">
            <span className="field-label">Уведомления о новом уровне</span>
            <div className="level-fields">
              <label>
                Куда отправлять
                <Select value={value.notify_mode} onChange={mode => set({ notify_mode: mode as NotifyMode })} ariaLabel="Куда отправлять уведомления об уровне"
                  options={notifyOptions}/>
              </label>
              {needsChannel && (
                <label>
                  Канал
                  <Select value={value.notify_channel_id ?? ""} onChange={channelId => set({ notify_channel_id: channelId || null })} ariaLabel="Канал уведомлений об уровне"
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
                <CheckList items={channels} selected={value.ignored_channel_ids} channel label="Каналы" onChange={ignored_channel_ids => set({ ignored_channel_ids })}/>
                <p className="hint">Если ничего не выбрано, опыт начисляется во всех каналах.</p>
              </div>
              <div>
                <span className="muted">Роли</span>
                <CheckList items={roles} selected={value.ignored_role_ids} label="Роли" onChange={ignored_role_ids => set({ ignored_role_ids })}/>
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
                      onChange={e => { const level = Math.max(1, Math.min(MAX_LEVEL, Number(e.target.value) || 1)); if (rewards.some((entry, n) => n !== index && entry.level === level)) return; onRewardsChange(rewards.map((entry, n) => n === index ? { ...entry, level } : entry)); }}/>
                    <Select value={reward.role_id} placeholder="Выберите роль" ariaLabel={`Роль за ${reward.level} уровень`}
                      onChange={roleId => onRewardsChange(rewards.map((entry, n) => n === index ? { ...entry, role_id: roleId } : entry))}
                      options={roles.map(role => ({ value: role.id, label: role.name }))}/>
                    <button type="button" className="btn danger small icon-only" onClick={() => onRewardsChange(rewards.filter((_, n) => n !== index))} aria-label={`Удалить награду за уровень ${reward.level}`}><Trash2 size={14}/></button>
                  </div>
                ))}
              </div>
            )}
            {rewards.length < MAX_REWARDS && addLevel !== null && (
              <button type="button" className="btn secondary" disabled={!roles.length}
                onClick={() => onRewardsChange([...rewards, { level: addLevel, role_id: roles[0]?.id ?? "" }])}>Добавить награду</button>
            )}
            {!roles.length && <p className="hint">Нет ролей, которые бот может выдавать: поднимите его роль выше нужных в Discord.</p>}
          </section>
        </div>
      </article>
    </section>
  );
}
