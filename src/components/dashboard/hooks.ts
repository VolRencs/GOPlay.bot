"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

type AsyncFetchOptions<T> = {
  enabled?: boolean;
  request: (signal: AbortSignal) => Promise<ApiResult<T>>;
  onData: (data: T) => void;
  onError?: (error: string) => void;
};

function useAsyncFetch<T>(options: AsyncFetchOptions<T>, deps: readonly unknown[]) {
  const enabled = options.enabled !== false;
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const depsKey = stableJson(deps);
  useEffect(() => {
    if (!enabled) { setLoading(false); setError(null); return; }
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void optionsRef.current.request(controller.signal).then(
      result => {
        if (!active) return;
        if (result.ok) optionsRef.current.onData(result.data);
        else {
          setError(result.error);
          optionsRef.current.onError?.(result.error);
        }
        setLoading(false);
      },
      () => {
        if (!active) return;
        const message = "Не удалось загрузить данные.";
        setError(message);
        optionsRef.current.onError?.(message);
        setLoading(false);
      },
    );
    return () => { active = false; controller.abort(); };
  }, [enabled, depsKey, generation]);
  return { loading, error, reload: useCallback(() => setGeneration(value => value + 1), []) };
}

export function useApiResource<T>(enabled: boolean, load: (signal: AbortSignal) => Promise<ApiResult<T>>, deps: readonly unknown[], initial: T) {
  const [data, setData] = useState<T>(initial);
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const depsKey = stableJson(deps);
  useEffect(() => { setData(initialRef.current); }, [depsKey]);
  const { loading, error, reload } = useAsyncFetch<T>({ enabled, request: load, onData: setData }, deps);
  return { data, setData, loading, error, reload };
}

export { useAsyncFetch as useApiLoad };

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
