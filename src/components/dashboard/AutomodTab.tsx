"use client";

import { useState } from "react";
import { defaultRule, type AutomodGetDto, type AutomodRuleDto, type AutomodSecurityInput } from "#contracts/automod.ts";
import { AutoModSettings } from "./AutomodPanel.tsx";
import { apiJson, apiSend } from "./api.ts";
import { useDashboard, useRegisterChanges } from "./DashboardContext.tsx";
import { useApiLoad } from "./hooks.ts";
import { SectionError, SectionLoading, stableStringify } from "./ui.tsx";

export function AutomodTab() {
  const { guildId, resources, notify, fail } = useDashboard();
  const [rules, setRules] = useState<Record<string, AutomodRuleDto>>({});
  const [ignoredRoleIds, setIgnoredRoleIds] = useState<string[]>([]);
  const [protectedChannelId, setProtectedChannelId] = useState<string | null>(null);
  const [savedRules, setSavedRules] = useState<Record<string, AutomodRuleDto> | null>(null);
  const [savedSecurity, setSavedSecurity] = useState<{ roles: string[]; channel: string | null } | null>(null);

  const { loading, error: loadError, reload } = useApiLoad<AutomodGetDto>({
    request: signal => apiSend<AutomodGetDto>(`/api/guilds/${guildId}/automod`, { signal }, "Не удалось загрузить автомодерацию."),
    onData: data => {
      const nextRules = Object.fromEntries(data.rules.map(rule => [rule.kind, rule]));
      setRules(nextRules);
      setIgnoredRoleIds(data.ignoredRoleIds);
      setProtectedChannelId(data.protectedChannelId);
      setSavedRules(nextRules);
      setSavedSecurity({ roles: data.ignoredRoleIds, channel: data.protectedChannelId });
    },
    onError: fail,
  }, [guildId, fail]);

  const ruleDirty = (kind: string) => savedRules !== null && (savedRules[kind] === undefined || stableStringify(savedRules[kind]) !== stableStringify(rules[kind]));
  const rulesDirty = Object.keys(rules).some(ruleDirty);
  const securityDirty = savedSecurity !== null && (stableStringify(savedSecurity.roles) !== stableStringify(ignoredRoleIds) || savedSecurity.channel !== protectedChannelId);
  const dirty = rulesDirty || securityDirty;

  async function saveRule(kind: string): Promise<boolean> {
    const current = rules[kind] ?? defaultRule(kind);
    const sent = await apiJson<{ unchanged?: boolean }>(`/api/guilds/${guildId}/automod`, "PUT", current, "Не удалось сохранить правило.");
    if (!sent.ok) { fail(sent.error); return false; }
    setRules(value => ({ ...value, [kind]: current }));
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
  if (loadError) return <SectionError message={loadError} onRetry={reload}/>;
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
