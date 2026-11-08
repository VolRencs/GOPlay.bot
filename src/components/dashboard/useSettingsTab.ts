"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson, apiSend } from "./api.ts";
import { useConfigDraft } from "./hooks.ts";
import { useDashboard, useRegisterChanges } from "./DashboardContext.tsx";
import { useAsyncAction } from "./ui.tsx";
import { settingsEndpoint, type SettingsKey } from "#contracts/dashboard.ts";

type SettingsTabOptions<TGet, TValue> = {
  settingsKey: SettingsKey;
  initial: TValue;
  fromGet: (data: TGet) => TValue;
  toBody: (value: TValue) => unknown;
  afterSave?: (value: TValue, data: unknown) => TValue;
  saveMode?: "commit" | "markSaved";
  loadError: string;
  saveError: string;
  savedMessage: string;
};

export function useSettingsTab<TGet, TValue>(options: SettingsTabOptions<TGet, TValue>) {
  const { guildId, notify, fail } = useDashboard();
  const draft = useConfigDraft(options.initial);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadGeneration, setLoadGeneration] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Settings endpoints live in SETTINGS_ENDPOINTS; never derive API paths ad hoc.
  const endpoint = settingsEndpoint(guildId, options.settingsKey);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    void apiSend<TGet>(endpoint, { signal: controller.signal }, options.loadError).then(result => {
      if (!active) return;
      if (result.ok) draftRef.current.commit(optionsRef.current.fromGet(result.data));
      else {
        setLoadError(result.error);
        fail(result.error);
      }
      setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [endpoint, options.loadError, fail, loadGeneration]);

  const reload = useCallback(() => setLoadGeneration(value => value + 1), []);

  const save = useCallback(async (report = true): Promise<boolean> => {
    const current = draftRef.current;
    const sent = await apiJson<{ unchanged?: boolean } & Record<string, unknown>>(endpoint, "PUT", optionsRef.current.toBody(current.value), optionsRef.current.saveError);
    if (!sent.ok) {
      fail(sent.error);
      return false;
    }
    const next = optionsRef.current.afterSave ? optionsRef.current.afterSave(current.value, sent.data) : current.value;
    if (optionsRef.current.saveMode === "markSaved") current.markSaved(next);
    else current.commit(next);
    if (report) notify(sent.data.unchanged ? "Изменений нет." : optionsRef.current.savedMessage);
    return true;
  }, [endpoint, fail, notify]);

  const { busy: saving, run } = useAsyncAction();
  const saveNow = useCallback(() => run(save), [run, save]);

  useRegisterChanges(options.settingsKey, { dirty: draft.dirty, save, discard: () => draftRef.current.reset() });

  return { ...draft, loading, loadError, reload, save, saving, saveNow };
}
