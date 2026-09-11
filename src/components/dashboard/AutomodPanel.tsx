"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { automodRules } from "../../../src/lib/labels.ts";
import { parseActions, safeJson } from "../../../src/lib/json.ts";
import { automodDefaultActions, automodThresholdDefaults } from "../../../src/lib/automod.ts";
import { MAX_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS } from "../../../src/lib/constants.ts";
import type { Channel, Role, Rule } from "./types.ts";
import { CardHeader, CheckList, channelOptions, NumberField, SaveButton, Select, useAsyncAction } from "./ui.tsx";

const punishmentPresets = [
  { value: "delete", label: "Удалить сообщение", actions: ["delete"] },
  { value: "warn", label: "Удалить и предупредить", actions: [...automodDefaultActions] },
  { value: "timeout", label: "Удалить и выдать тайм-аут", actions: ["delete", "timeout"] },
  { value: "kick", label: "Удалить и кикнуть", actions: ["delete", "kick"] },
  { value: "ban", label: "Удалить и забанить", actions: ["delete", "ban"] },
];
const presetFor = (actions: string[]) => punishmentPresets.find(p => p.actions.length === actions.length && p.actions.every(action => actions.includes(action)))?.value ?? "warn";

const CHANNEL_SCOPED_KINDS = ["links", "links_only", "media_only"];
const WINDOW_KINDS = ["spam", "duplicate", "emoji"];

// Новые правила сидируются теми же дефолтами, что и детекторы в рантайме:
// несохранённое правило ведёт себя как сохранённое.
export function defaultRule(kind: string): Rule {
  return { kind, enabled: 0, action_json: JSON.stringify([...automodDefaultActions]), threshold_json: JSON.stringify({ ...(automodThresholdDefaults as Record<string, Record<string, unknown>>)[kind] ?? {}, durationSeconds: DEFAULT_TIMEOUT_SECONDS }), window_seconds: 10, escalation: 0 };
}

function RuleThreshold({ kind, threshold, onChange }: { kind: string; threshold: Record<string, unknown>; onChange: (change: Record<string, unknown>) => void }) {
  const field = (label: string, key: string) => (
    <NumberField key={key} label={label} min={1} value={Number(threshold[key] ?? 1)} onChange={value => onChange({ [key]: value || 1 })}/>
  );
  if (kind === "spam") return field("Сообщений", "messages");
  if (kind === "duplicate") return field("Повторов", "repeatCount");
  if (kind === "caps") return <>{field("Минимум букв", "minimumCharacters")}{field("Заглавных, %", "uppercasePercentage")}</>;
  if (kind === "emoji") return field("Эмодзи", "maxEmojiCount");
  if (kind === "mentions") return field("Упоминаний", "maxMentions");
  if (kind === "links") {
    return (
      <label>
        Режим ссылок
        <Select
          value={String(threshold.mode ?? "block_all")}
          onChange={value => onChange({ mode: value })}
          ariaLabel="Режим ссылок"
          options={[
            { value: "block_all", label: "Блокировать все" },
            { value: "allowlist", label: "Разрешать только домены ниже" },
            { value: "blocklist", label: "Блокировать домены ниже" },
          ]}/>
      </label>
    );
  }
  if (kind === "invites") {
    const allow = String(threshold.mode ?? "block") === "allow";
    return (
      <>
        <label>
          Инвайты
          <Select
            value={String(threshold.mode ?? "block")}
            onChange={value => onChange({ mode: value })}
            ariaLabel="Режим инвайтов"
            options={[{ value: "block", label: "Блокировать инвайты" }, { value: "allow", label: "Разрешить инвайты" }]}/>
        </label>
        {allow && <p className="hint">В этом режиме правило не срабатывает.</p>}
      </>
    );
  }
  return null;
}

function DomainListEditor({ domains, onChange }: { domains: string[]; onChange: (domains: string[]) => void }) {
  const [value, setValue] = useState("");
  const list = domains.filter(Boolean);
  const add = () => { const domain = value.trim().toLowerCase(); if (!domain || list.includes(domain)) { setValue(""); return; } onChange([...list, domain]); setValue(""); };
  const update = (index: number, next: string) => { const clean = next.trim().toLowerCase(); onChange(clean ? list.map((domain, i) => i === index ? clean : domain) : list.filter((_, i) => i !== index)); };
  return (
    <div className="domain-editor">
      <div className="domain-input-row">
          <input value={value} aria-label="Новый домен" placeholder="example.com" onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}/>
        <button type="button" className="btn secondary" onClick={add}>Добавить</button>
      </div>
      {list.length
        ? <div className="domain-list">{list.map((domain, index) => (
            <span className="domain-item" key={`${domain}-${index}`}>
              <input value={domain} aria-label={`Домен ${index + 1}`} onChange={e => update(index, e.target.value)}/>
              <button type="button" className="btn danger small icon-only" onClick={() => onChange(list.filter((_, i) => i !== index))} aria-label={`Удалить ${domain}`}><Trash2 size={14}/></button>
            </span>
          ))}</div>
        : <span className="hint">Домены без протокола, например example.com. Проверяется точное имя хоста — при необходимости добавьте поддомен отдельно.</span>}
    </div>
  );
}

type RuleMeta = { title: string; description: string };

function RuleCard({ meta, rule, channels, onChange }: { meta: RuleMeta; rule: Rule; channels: Channel[]; onChange: (kind: string, change: Partial<Rule>) => void }) {
  const kind = rule.kind;
  const threshold = { ...safeJson<Record<string, unknown>>(defaultRule(kind).threshold_json, {}), ...safeJson<Record<string, unknown>>(rule.threshold_json, {}) };
  const actions = parseActions(rule.action_json);
  const channelsValue = Array.isArray(threshold.channels) ? threshold.channels.map(String) : [];
  const setThreshold = (change: Record<string, unknown>) => onChange(kind, { threshold_json: JSON.stringify({ ...threshold, ...change }) });
  const timeoutMinutes = Math.round(Number(threshold.durationSeconds ?? DEFAULT_TIMEOUT_SECONDS) / 60);
  const state = Boolean(rule.enabled);
  return (
    <article className={state ? "card rule-card" : "card rule-card is-off"}>
      <div className="rule-heading">
        <div>
          <h2>{meta.title}</h2>
          <p className="muted">{meta.description}</p>
        </div>
        <label className="switch">
          <input type="checkbox" aria-label={`Включить правило «${meta.title}»`} checked={state} onChange={e => onChange(kind, { enabled: +e.target.checked })}/>
          <span/>
        </label>
      </div>
      <div className="rule-fields">
        <div className="rule-config">
          <RuleThreshold kind={kind} threshold={threshold} onChange={setThreshold}/>
          {kind === "links" && ["allowlist", "blocklist"].includes(String(threshold.mode ?? "block_all")) && (
            <div className="choice-field">
              <span className="field-label">{String(threshold.mode) === "allowlist" ? "Разрешённые домены" : "Заблокированные домены"}</span>
              <DomainListEditor domains={Array.isArray(threshold.domains) ? threshold.domains.map(String) : []} onChange={domains => setThreshold({ domains })}/>
            </div>
          )}
          {CHANNEL_SCOPED_KINDS.includes(kind) && (
            <div className="choice-field">
              <span className="field-label">Каналы, где действует правило</span>
              <CheckList items={channels} selected={channelsValue} channel onChange={value => setThreshold({ channels: value })} label={`Каналы правила «${meta.title}»`}/>
              <span className="hint">Если каналы не выбраны, правило действует во всех каналах.</span>
            </div>
          )}
          {kind === "media_only" && (
            <label>Что разрешено<Select
              value={String(threshold.media ?? "any")}
              onChange={value => setThreshold({ media: value })}
              ariaLabel="Что разрешено"
              options={[{ value: "any", label: "Фото и видео" }, { value: "image", label: "Только фото" }, { value: "video", label: "Только видео" }]}/></label>
          )}
          {WINDOW_KINDS.includes(kind) && (
            <NumberField label="Период проверки, сек" min={1} max={3600} value={rule.window_seconds} onChange={window_seconds => onChange(kind, { window_seconds: window_seconds || 1 })}/>
          )}
        </div>
        <div className="punishment-box">
          <span className="field-label">Наказание</span>
          <label>Действие<Select
            value={presetFor(actions)}
            onChange={value => onChange(kind, { action_json: JSON.stringify(punishmentPresets.find(p => p.value === value)?.actions ?? [...automodDefaultActions]) })}
            ariaLabel="Действие"
            options={punishmentPresets.map(p => ({ value: p.value, label: p.label }))}/></label>
          {actions.includes("timeout") && (
            <>
              <NumberField label="Тайм-аут, минут" min={1} max={40320} value={timeoutMinutes} onChange={minutes => setThreshold({ durationSeconds: Math.max(1, Math.min(MAX_TIMEOUT_SECONDS, (minutes || 1) * 60)) })}/>
              <label className="check-row">
                <input type="checkbox" checked={Boolean(rule.escalation)} onChange={e => onChange(kind, { escalation: +e.target.checked })}/> Усиливать тайм-аут при повторах за 24 ч
              </label>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export function AutoModSettings({ channels, roles, rules, ignoredRoleIds, protectedChannelId, onGlobalChange, onSaveAll, onChange }: { channels: Channel[]; roles: Role[]; rules: Record<string, Rule>; ignoredRoleIds: string[]; protectedChannelId: string | null; onGlobalChange: (roles: string[], channel: string | null) => void; onSaveAll: () => unknown; onChange: (kind: string, change: Partial<Rule>) => void }) {
  const { busy: saving, run } = useAsyncAction();
  const enabledCount = Object.keys(automodRules).filter(kind => Boolean(rules[kind]?.enabled)).length;
  return (
    <section className="panel-stack">
      <article className="card settings-card">
        <CardHeader title="Правила автомодерации" note={`включено ${enabledCount} из ${Object.keys(automodRules).length}`} muted="Каждое правило работает независимо: включайте нужные и настраивайте условия с наказанием в карточках ниже."
          action={<SaveButton saving={saving} onClick={() => run(onSaveAll)} label="Сохранить автомодерацию"/>}/>
      </article>
      <article className="card settings-card">
        <CardHeader title="Общие исключения" muted="Действуют сразу для всех правил ниже."/>
        <div className="automod-global-grid">
          <div>
            <span className="field-label">Роли-исключения</span>
            <CheckList items={roles} selected={ignoredRoleIds} onChange={value => onGlobalChange(value, protectedChannelId)} label="Роли-исключения"/>
            <span className="hint">Отмеченные роли не затрагиваются ни одним правилом.</span>
          </div>
          <div>
            <label>
              Защищённый канал (ловушка)
              <Select
                value={protectedChannelId ?? ""}
                onChange={value => onGlobalChange(ignoredRoleIds, value || null)}
                ariaLabel="Защищённый канал"
                options={channelOptions(channels, "Не выбран")}/>
            </label>
            <span className="hint">В ловушку нельзя писать: сообщение удаляется, сообщения автора стираются по всему серверу, а сам автор блокируется.</span>
          </div>
        </div>
      </article>
      <div className="automod-rules-grid">
        {Object.entries(automodRules).map(([kind, meta]) => (
          <RuleCard key={kind} meta={meta} rule={rules[kind] ?? defaultRule(kind)} channels={channels} onChange={onChange}/>
        ))}
      </div>
    </section>
  );
}
