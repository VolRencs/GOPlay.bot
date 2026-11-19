"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { automodRules } from "#lib/labels.ts";
import { automodDefaultActions, automodThresholdRanges, automodWindowRange, type AutomodThresholdKey } from "#lib/automod.ts";
import { MAX_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS } from "#lib/constants.ts";
import { defaultRule, type AutomodGetDto, type AutomodRuleDto, type AutomodSecurityInput } from "#contracts/automod.ts";
import { apiJson, apiSend } from "./api.ts";
import { useDashboard, useRegisterChanges } from "./DashboardContext.tsx";
import { useApiLoad } from "./hooks.ts";
import type { Channel } from "./types.ts";
import { CardHeader, CheckList, channelOptions, NumberField, SaveButton, SectionError, Select, useAsyncAction } from "./ui.tsx";
import { stableJson } from "../../lib/json.ts";

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

function RuleThreshold({ kind, threshold, onChange }: { kind: string; threshold: Record<string, unknown>; onChange: (change: Record<string, unknown>) => void }) {
  const field = (label: string, key: AutomodThresholdKey) => {
    const range = automodThresholdRanges[key];
    return (
      <NumberField key={key} label={label} min={range.min} max={range.max} value={Number(threshold[key] ?? range.min)} onChange={value => onChange({ [key]: Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : range.min })}/>
    );
  };
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
  const update = (index: number, next: string) => { const clean = next.trim().toLowerCase(); onChange(clean ? list.with(index, clean) : list.filter((_, i) => i !== index)); };
  return (
    <div className="domain-editor">
      <div className="domain-input-row">
          <input value={value} aria-label="Новый домен" placeholder="example.com" onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}/>
        <button type="button" className="btn secondary" onClick={add}>Добавить</button>
      </div>
      {list.length
        ? <div className="domain-list">{list.map((domain, index) => (
            <span className="domain-item" key={index}>
              <input value={domain} aria-label={`Домен ${index + 1}`} onChange={e => update(index, e.target.value)}/>
              <button type="button" className="btn danger small icon-only" onClick={() => onChange(list.filter((_, i) => i !== index))} aria-label={`Удалить ${domain}`}><Trash2 size={14}/></button>
            </span>
          ))}</div>
        : <span className="hint">Домены без протокола, например example.com. Проверяется точное имя хоста — при необходимости добавьте поддомен отдельно.</span>}
    </div>
  );
}

type RuleMeta = { title: string; description: string };

function RuleCard({ meta, rule, channels, onChange }: { meta: RuleMeta; rule: AutomodRuleDto; channels: Channel[]; onChange: (kind: string, change: Partial<AutomodRuleDto>) => void }) {
  const kind = rule.kind;
  const threshold = { ...defaultRule(kind).threshold, ...rule.threshold };
  const actions = rule.actions;
  const channelsValue = Array.isArray(threshold.channels) ? threshold.channels.map(String) : [];
  const setThreshold = (change: Record<string, unknown>) => onChange(kind, { threshold: { ...threshold, ...change } });
  const timeoutMinutes = Math.round(Number(threshold.durationSeconds ?? DEFAULT_TIMEOUT_SECONDS) / 60);
  const state = rule.enabled;
  return (
    <article className={state ? "card rule-card" : "card rule-card is-off"}>
      <div className="rule-heading">
        <div>
          <h2>{meta.title}</h2>
          <p className="muted">{meta.description}</p>
        </div>
        <label className="switch">
          <input type="checkbox" aria-label={`Включить правило «${meta.title}»`} checked={state} onChange={e => onChange(kind, { enabled: e.target.checked })}/>
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
            <NumberField label="Период проверки, сек" min={automodWindowRange.min} max={automodWindowRange.max} value={rule.windowSeconds} onChange={windowSeconds => onChange(kind, { windowSeconds: windowSeconds || automodWindowRange.min })}/>
          )}
        </div>
        <div className="punishment-box">
          <span className="field-label">Наказание</span>
          <label>Действие<Select
            value={presetFor(actions)}
            onChange={value => onChange(kind, { actions: punishmentPresets.find(p => p.value === value)?.actions ?? [...automodDefaultActions] })}
            ariaLabel="Действие"
            options={punishmentPresets.map(p => ({ value: p.value, label: p.label }))}/></label>
          {actions.includes("timeout") && (
            <>
              <NumberField label="Тайм-аут, минут" min={1} max={40320} value={timeoutMinutes} onChange={minutes => setThreshold({ durationSeconds: Math.max(1, Math.min(MAX_TIMEOUT_SECONDS, (minutes || 1) * 60)) })}/>
              <label className="check-row">
                <input type="checkbox" checked={rule.escalation} onChange={e => onChange(kind, { escalation: e.target.checked })}/> Усиливать тайм-аут при повторах за 24 ч
              </label>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export function AutomodTab() {
  const { guildId, resources, notify, fail } = useDashboard();
  const [rules, setRules] = useState<Record<string, AutomodRuleDto>>({});
  const [ignoredRoleIds, setIgnoredRoleIds] = useState<string[]>([]);
  const [protectedChannelId, setProtectedChannelId] = useState<string | null>(null);
  const [savedRules, setSavedRules] = useState<Record<string, AutomodRuleDto> | null>(null);
  const [savedSecurity, setSavedSecurity] = useState<{ roles: string[]; channel: string | null } | null>(null);
  const { busy: saving, run } = useAsyncAction();

  const { error: loadError, reload } = useApiLoad<AutomodGetDto>({
    request: signal => apiSend<AutomodGetDto>(`/api/guilds/${guildId}/automod`, { signal }, "Не удалось загрузить автомодерацию."),
    onData: data => {
      const nextRules = Object.fromEntries(data.rules.map(rule => [rule.kind, rule]));
      setRules(nextRules);
      setIgnoredRoleIds(data.ignoredRoleIds);
      setProtectedChannelId(data.protectedChannelId);
      setSavedRules(nextRules);
      setSavedSecurity({ roles: data.ignoredRoleIds, channel: data.protectedChannelId });
    },
  }, [guildId]);

  const ruleDirty = (kind: string) => savedRules !== null && (savedRules[kind] === undefined || stableJson(savedRules[kind]) !== stableJson(rules[kind]));
  const rulesDirty = Object.keys(rules).some(ruleDirty);
  const securityDirty = savedSecurity !== null && (stableJson(savedSecurity.roles) !== stableJson(ignoredRoleIds) || savedSecurity.channel !== protectedChannelId);
  const dirty = rulesDirty || securityDirty;

  async function saveRule(kind: string): Promise<boolean> {
    if (savedRules === null) return false;
    const current = rules[kind] ?? defaultRule(kind);
    const sent = await apiJson<{ unchanged?: boolean }>(`/api/guilds/${guildId}/automod`, "PUT", current, "Не удалось сохранить правило.");
    if (!sent.ok) { fail(sent.error); return false; }
    // Keep edits made while the request was in flight; the server has `current`.
    setRules(value => stableJson(value[kind] ?? defaultRule(kind)) === stableJson(current)
      ? { ...value, [kind]: current }
      : value);
    setSavedRules(value => value ? { ...value, [kind]: current } : { [kind]: current });
    return true;
  }

  async function saveSecurity(): Promise<boolean> {
    const body: AutomodSecurityInput = { kind: "security", ignoredRoleIds, protectedChannelId };
    const sent = await apiJson<{ unchanged?: boolean }>(`/api/guilds/${guildId}/automod`, "PUT", body, "Не удалось сохранить общие исключения.");
    if (!sent.ok) { fail(sent.error); return false; }
    setSavedSecurity({ roles: ignoredRoleIds, channel: protectedChannelId });
    return true;
  }

  async function save(report = true): Promise<boolean> {
    if (savedRules === null) return false;
    let ok = true;
    if (securityDirty) ok = await saveSecurity() && ok;
    for (const kind of Object.keys(rules)) {
      if (!ruleDirty(kind)) continue;
      ok = await saveRule(kind) && ok;
    }
    if (ok && report) notify("Настройки автомодерации сохранены.");
    return ok;
  }

  function discard() {
    if (savedRules) setRules(savedRules);
    if (savedSecurity) {
      setIgnoredRoleIds(savedSecurity.roles);
      setProtectedChannelId(savedSecurity.channel);
    }
  }

  useRegisterChanges("automod", { dirty, save, discard });

  if (loadError) return <SectionError message={loadError} onRetry={reload}/>;
  if (savedRules === null) return null;
  const channels = resources?.channels ?? [];
  const roles = resources?.roles ?? [];
  const enabledCount = Object.keys(automodRules).filter(kind => Boolean(rules[kind]?.enabled)).length;
  return (
    <section className="panel-stack">
      <article className="card settings-card">
        <CardHeader title="Правила автомодерации" note={`включено ${enabledCount} из ${Object.keys(automodRules).length}`} muted="Каждое правило работает независимо: включайте нужные и настраивайте условия с наказанием в карточках ниже."
          action={<SaveButton saving={saving} onClick={() => run(save)} label="Сохранить автомодерацию"/>}/>
      </article>
      <article className="card settings-card">
        <CardHeader title="Общие исключения" muted="Действуют сразу для всех правил ниже."/>
        <div className="automod-global-grid">
          <div>
            <span className="field-label">Роли-исключения</span>
            <CheckList items={roles} selected={ignoredRoleIds} onChange={value => setIgnoredRoleIds(value)} label="Роли-исключения"/>
            <span className="hint">Отмеченные роли не затрагиваются ни одним правилом.</span>
          </div>
          <div>
            <label>
              Защищённый канал (ловушка)
              <Select
                value={protectedChannelId ?? ""}
                onChange={value => setProtectedChannelId(value || null)}
                ariaLabel="Защищённый канал"
                options={channelOptions(channels, "Не выбран")}/>
            </label>
            <span className="hint">В ловушку нельзя писать: сообщение удаляется, сообщения автора стираются по всему серверу, а сам автор блокируется.</span>
          </div>
        </div>
      </article>
      <div className="automod-rules-grid">
        {Object.entries(automodRules).map(([kind, meta]) => (
          <RuleCard key={kind} meta={meta} rule={rules[kind] ?? defaultRule(kind)} channels={channels} onChange={(kind, change) => {
            const current = rules[kind] ?? defaultRule(kind);
            setRules(value => ({ ...value, [kind]: { ...current, ...change } }));
          }}/>
        ))}
      </div>
    </section>
  );
}
