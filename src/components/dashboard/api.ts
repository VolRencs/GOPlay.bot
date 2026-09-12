type ApiError = { error?: unknown };

/** Канонический результат клиентского запроса: панель и хуки используют один тип. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Достаёт человекочитаемую ошибку из ответа API (единый формат `{error}`). */
async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({}) as ApiError);
  const error = (data as ApiError).error;
  return typeof error === "string" && error ? error : fallback;
}

/** GET с тихим фолбэком — канонический вариант «панель не должна падать,
 *  если вкладка открыта без сети». Ошибки не различаются от пустых данных:
 *  панели показывают нейтральное состояние. */
export async function apiGet<T>(url: string, fallback: T, signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(url, signal ? { signal } : {});
    if (!response.ok) return fallback;
    return await response.json() as T;
  } catch {
    return fallback;
  }
}

/** Мутация с разбором тела: успех возвращает JSON ответа ({}, если тела нет),
 *  неудача — человекочитаемую ошибку. Сетевой сбой не бросает исключение —
 *  панелям не нужна собственная обвязка try/catch вокруг fetch. */
export async function apiSend<T>(url: string, init: RequestInit, failMessage: string): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return { ok: false, error: "Нет соединения с сервером." };
  }
  if (!response.ok) return { ok: false, error: await apiErrorMessage(response, failMessage) };
  return { ok: true, data: await response.json().catch(() => ({})) as T };
}

/** Мутация без нужды в теле ответа: только факт успеха и текст ошибки.
 *  data: undefined сохраняет единый ApiResult-контракт usePanelAction. */
export async function apiMutate(url: string, init: RequestInit, failMessage: string): Promise<ApiResult<undefined>> {
  const result = await apiSend<unknown>(url, init, failMessage);
  return result.ok ? { ok: true, data: undefined } : result;
}
