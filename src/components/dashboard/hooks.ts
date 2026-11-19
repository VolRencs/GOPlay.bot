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
  request: (signal: AbortSignal) => Promise<ApiResult<T>>;
  onData: (data: T) => void;
};

type FetchError = { key: string; message: string };

function useAsyncFetch<T>(options: AsyncFetchOptions<T>, deps: readonly unknown[]) {
  const [errorState, setErrorState] = useState<FetchError | null>(null);
  const [generation, setGeneration] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const depsKey = stableJson(deps);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const options = optionsRef.current;
    setErrorState(null);
    void options.request(controller.signal).then(
      result => {
        if (!active) return;
        if (result.ok) options.onData(result.data);
        else setErrorState({ key: depsKey, message: result.error });
      },
      () => {
        if (active) setErrorState({ key: depsKey, message: "Не удалось загрузить данные." });
      },
    );
    return () => { active = false; controller.abort(); };
  }, [depsKey, generation]);
  const error = errorState?.key === depsKey ? errorState.message : null;
  return { error, reload: useCallback(() => setGeneration(value => value + 1), []) };
}

export function useApiResource<T>(load: (signal: AbortSignal) => Promise<ApiResult<T>>, deps: readonly unknown[], initial: T) {
  const depsKey = stableJson(deps);
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const [state, setState] = useState(() => ({ key: depsKey, data: initial }));
  const data = state.key === depsKey ? state.data : initialRef.current;
  const setData = useCallback((value: T | ((current: T) => T)) => {
    setState(current => {
      const base = current.key === depsKey ? current.data : initialRef.current;
      return { key: depsKey, data: typeof value === "function" ? (value as (current: T) => T)(base) : value };
    });
  }, [depsKey]);
  const { error, reload } = useAsyncFetch<T>({ request: load, onData: setData }, deps);
  return { data, setData, error, reload };
}

export { useAsyncFetch as useApiLoad };

export function usePanelAction(options: { onDone: PanelNotify; onError: PanelFail }) {
  const { busy, run: runAction } = useAsyncAction();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const run = <T,>(request: () => Promise<ApiResult<T>>, done: (data: T) => PanelOutcome, reload?: () => void) =>
    runAction(async () => {
      const result = await request();
      if (!result.ok) { optionsRef.current.onError(result.error); return false; }
      const outcome = done(result.data);
      if (outcome?.message) optionsRef.current.onDone(outcome.message, outcome.tone);
      reload?.();
      return true;
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
