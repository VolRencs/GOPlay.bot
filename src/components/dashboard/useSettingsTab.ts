"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiSend } from "./api.ts";
import { useConfigDraft } from "./hooks.ts";
import { useRegisterChanges } from "./DashboardContext.tsx";
import type { PanelFail, PanelNotify } from "./types.ts";

type SettingsTabOptions<TGet, TValue> = {
  endpoint: string;
  initial: TValue;
  fromGet: (data: TGet) => TValue;
  toBody: (value: TValue) => unknown;
  afterSave?: (value: TValue, data: unknown) => TValue;
  saveMode?: "commit" | "markSaved";
  loadError: string;
  saveError: string;
  savedMessage: string;
  registerKey: string;
  onDone: PanelNotify;
  onError: PanelFail;
};

export function useSettingsTab<TGet, TValue>(options: SettingsTabOptions<TGet, TValue>) {
  const draft = useConfigDraft(options.initial);
  const [loading, setLoading] = useState(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    let active = true;
    setLoading(true);
    void apiSend<TGet>(options.endpoint, {}, options.loadError).then(result => {
      if (!active) return;
      if (result.ok) draftRef.current.commit(optionsRef.current.fromGet(result.data));
      else {
        draftRef.current.commit(optionsRef.current.initial);
        optionsRef.current.onError(result.error);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [options.endpoint, options.loadError]);

  const save = useCallback(async (report = true): Promise<boolean> => {
    const current = draftRef.current;
    const sent = await apiSend<{ unchanged?: boolean } & Record<string, unknown>>(optionsRef.current.endpoint, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(optionsRef.current.toBody(current.value)),
    }, optionsRef.current.saveError);
    if (!sent.ok) {
      optionsRef.current.onError(sent.error);
      return false;
    }
    const next = optionsRef.current.afterSave ? optionsRef.current.afterSave(current.value, sent.data) : current.value;
    if (optionsRef.current.saveMode === "markSaved") current.markSaved(next);
    else current.commit(next);
    if (report) optionsRef.current.onDone(sent.data.unchanged ? "Изменений нет." : optionsRef.current.savedMessage);
    return true;
  }, []);

  useRegisterChanges(options.registerKey, { dirty: draft.dirty, save, discard: () => draftRef.current.reset() });

  return { ...draft, loading, save };
}
