"use client";

import { useEffect, useRef, useState } from "react";
import { stableJson } from "../../lib/json.ts";
import { useAsyncAction, useObjectUrl } from "./ui.tsx";
import type { ApiResult } from "./api.ts";
import type { PanelFail, PanelNotify } from "./types.ts";

type PanelOutcome = { message?: string; tone?: "ok" | "warn" } | void;

export function useMediaField(savedValue: string) {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = useObjectUrl(file) || savedValue;
  const clear = () => { setFile(null); if (inputRef.current) inputRef.current.value = ""; };
  return { file, setFile, inputRef, preview, clear };
}

export function useApiResource<T>(enabled: boolean, load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[], fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const depsKey = stableJson(deps);
  const [generation, setGeneration] = useState(0);
  useEffect(() => { setData(fallback); }, [depsKey]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    void load(controller.signal).then(
      value => { if (active) setData(value); },
      () => {  },
    );
    return () => { active = false; controller.abort(); };
  }, [enabled, depsKey, generation]);
  return { data, setData, reload: () => setGeneration(value => value + 1) };
}

export function usePanelAction(options: { onDone: PanelNotify; onError: PanelFail }) {
  const { busy, run: runAction } = useAsyncAction();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const run = <T,>(request: () => Promise<ApiResult<T>>, done: (data: T) => PanelOutcome, reload?: () => void) =>
    runAction(async () => {
      const result = await request();
      if (!result.ok) { optionsRef.current.onError(result.error); return; }
      const outcome = done(result.data);
      if (outcome?.message) optionsRef.current.onDone(outcome.message, outcome.tone);
      reload?.();
    });
  return { busy, run };
}

export function useConfigDraft<T>(initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [saved, setSaved] = useState<T | null>(null);
  const commit = (next: T) => { setValue(next); setSaved(next); };
  const markSaved = (next: T) => setSaved(next);
  const patch = (update: (current: T) => T) => { setValue(update); setSaved(current => current === null ? current : update(current)); };
  const reset = () => { if (saved !== null) setValue(saved); };
  return { value, setValue, saved, commit, markSaved, patch, reset, dirty: saved !== null && stableJson(value) !== stableJson(saved) };
}
