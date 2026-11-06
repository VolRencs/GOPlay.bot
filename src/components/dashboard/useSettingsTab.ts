"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson, apiSend } from "./api.ts";
import { useConfigDraft } from "./hooks.ts";
import { useDashboard, useRegisterChanges } from "./DashboardContext.tsx";
import { useAsyncAction } from "./ui.tsx";

type SettingsTabOptions<TGet, TValue> = {
  /** По умолчанию endpoint совпадает с registerKey: /api/guilds/{guildId}/{registerKey}. */
  endpoint?: string;
  initial: TValue;
  fromGet: (data: TGet) => TValue;
  toBody: (value: TValue) => unknown;
  afterSave?: (value: TValue, data: unknown) => TValue;
  saveMode?: "commit" | "markSaved";
  loadError: string;
  saveError: string;
  savedMessage: string;
  registerKey: string;
};

export function useSettingsTab<TGet, TValue>(options: SettingsTabOptions<TGet, TValue>) {
  const { guildId, notify, fail } = useDashboard();
  const draft = useConfigDraft(options.initial);
  const [loading, setLoading] = useState(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const endpoint = options.endpoint ?? `/api/guilds/${guildId}/${options.registerKey}`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    void apiSend<TGet>(endpoint, {}, options.loadError).then(result => {
      if (!active) return;
      if (result.ok) draftRef.current.commit(optionsRef.current.fromGet(result.data));
      else {
        draftRef.current.commit(optionsRef.current.initial);
        fail(result.error);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [endpoint, options.loadError, fail]);

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

  useRegisterChanges(options.registerKey, { dirty: draft.dirty, save, discard: () => draftRef.current.reset() });

  return { ...draft, loading, save, saving, saveNow };
}
