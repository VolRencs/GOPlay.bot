"use client";

import { useEffect, useState } from "react";
import { defaultRule, type AutomodGetDto, type AutomodRuleDto, type AutomodSecurityInput } from "#contracts/automod.ts";
import { AutoModSettings } from "./AutomodPanel.tsx";
import { apiSend } from "./api.ts";
import { useDashboard, useRegisterChanges } from "./DashboardContext.tsx";
import { SectionLoading, stableStringify } from "./ui.tsx";

export function AutomodTab() {
  const { guildId, resources, notify, fail } = useDashboard();
  const [rules, setRules] = useState<Record<string, AutomodRuleDto>>({});
  const [ignoredRoleIds, setIgnoredRoleIds] = useState<string[]>([]);
  const [protectedChannelId, setProtectedChannelId] = useState<string | null>(null);
  const [savedRules, setSavedRules] = useState<Record<string, AutomodRuleDto> | null>(null);
  const [savedSecurity, setSavedSecurity] = useState<{ roles: string[]; channel: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void apiSend<AutomodGetDto>(`/api/guilds/${guildId}/automod`, {}, "Не удалось загрузить автомодерацию.").then(result => {
      if (!active) return;
      if (result.ok) {
        const nextRules = Object.fromEntries(result.data.rules.map(rule => [rule.kind, rule]));
        setRules(nextRules);
        setIgnoredRoleIds(result.data.ignoredRoleIds);
        setProtectedChannelId(result.data.protectedChannelId);
        setSavedRules(nextRules);
        setSavedSecurity({ roles: result.data.ignoredRoleIds, channel: result.data.protectedChannelId });
      } else {
        setSavedRules({});
        setSavedSecurity({ roles: [], channel: null });
        fail(result.error);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [guildId, fail]);

  const ruleDirty = (kind: string) => savedRules !== null && (savedRules[kind] === undefined || stableStringify(savedRules[kind]) !== stableStringify(rules[kind]));
  const rulesDirty = Object.keys(rules).some(ruleDirty);
  const securityDirty = savedSecurity !== null && (stableStringify(savedSecurity.roles) !== stableStringify(ignoredRoleIds) || savedSecurity.channel !== protectedChannelId);
  const dirty = rulesDirty || securityDirty;

  async function saveRule(kind: string): Promise<boolean> {
    const current = rules[kind] ?? defaultRule(kind);
    const sent = await apiSend<{ unchanged?: boolean }>(`/api/guilds/${guildId}/automod`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(current) }, "Не удалось сохранить правило.");
    if (!sent.ok) { fail(sent.error); return false; }
    setRules(value => ({ ...value, [kind]: current }));
    setSavedRules(value => value ? { ...value, [kind]: current } : { [kind]: current });
    return true;
  }

  async function saveSecurity(): Promise<boolean> {
    const body: AutomodSecurityInput = { kind: "security", ignoredRoleIds, protectedChannelId };
    const sent = await apiSend<{ unchanged?: boolean }>(`/api/guilds/${guildId}/automod`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, "Не удалось сохранить общие исключения.");
    if (!sent.ok) { fail(sent.error); return false; }
    setSavedSecurity({ roles: ignoredRoleIds, channel: protectedChannelId });
    return true;
  }

  async function save(report = true): Promise<boolean> {
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

  if (loading) return <SectionLoading/>;
  return <AutoModSettings
    channels={resources?.channels ?? []}
    roles={resources?.roles ?? []}
    rules={rules}
    ignoredRoleIds={ignoredRoleIds}
    protectedChannelId={protectedChannelId}
    onGlobalChange={(roles, channel) => { setIgnoredRoleIds(roles); setProtectedChannelId(channel); }}
    onSaveAll={() => save()}
    onChange={(kind, change) => {
      const current = rules[kind] ?? defaultRule(kind);
      setRules(value => ({ ...value, [kind]: { ...current, ...change } }));
    }}
  />;
}
