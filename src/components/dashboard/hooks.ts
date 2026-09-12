"use client";

import { useEffect, useRef, useState } from "react";
import { stableJson } from "../../lib/json.ts";
import { useAsyncAction } from "./ui.tsx";
import type { ApiResult } from "./api.ts";
import type { PanelFail, PanelNotify } from "./types.ts";

type PanelOutcome = { message?: string; tone?: "ok" | "warn" } | void;

/** Единая загрузка данных панели: отменяет устаревшие запросы, даёт ручной
 *  reload. fallback показывается до первого ответа и при смене deps; reload
 *  сохраняет текущие данные — список не мигает «загружаем». */
export function useApiResource<T>(enabled: boolean, load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[], fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const depsKey = stableJson(deps);
  const [generation, setGeneration] = useState(0);
  // Смена deps — новый снимок: fallback и load берутся из того же рендера.
  useEffect(() => { setData(fallback); }, [depsKey]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    // Ошибка загрузки не затирает уже показанные данные: остаёмся на прошлом снимке.
    void load(controller.signal).then(
      value => { if (active) setData(value); },
      () => { /* предыдущий снимок сохраняется */ },
    );
    return () => { active = false; controller.abort(); };
  }, [enabled, depsKey, generation]);
  return { data, setData, reload: () => setGeneration(value => value + 1) };
}

/** Единый эпилог мутаций панелей: ошибка → onError, иначе сообщение об успехе
 *  (по данным ответа) и опциональный reload. */
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

/** Пара «редактируемое значение + сохранённый снимок» для dirty-check карточек:
 *  commit фиксирует успешное сохранение, reset возвращает последний снимок. */
export function useConfigDraft<T>(initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [saved, setSaved] = useState<T | null>(null);
  const commit = (next: T) => { setValue(next); setSaved(next); };
  // Сервер не канонизирует значение (welcome/logging/lang): фиксируем только
  // снимок, чтобы правки, сделанные во время запроса, не откатились.
  const markSaved = (next: T) => setSaved(next);
  // Локальная правка, которая не делает черновик грязным (например, загрузка фона).
  const patch = (update: (current: T) => T) => { setValue(update); setSaved(current => current === null ? current : update(current)); };
  const reset = () => { if (saved !== null) setValue(saved); };
  return { value, setValue, saved, commit, markSaved, patch, reset, dirty: saved !== null && stableJson(value) !== stableJson(saved) };
}
