type ApiError = { error?: unknown };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type UploadProgress = { loaded: number; total: number; percent: number };

async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({}) as ApiError);
  const error = (data as ApiError).error;
  return typeof error === "string" && error ? error : fallback;
}

function redirectOnUnauthorized(status: number): void {
  if (status === 401 && typeof window !== "undefined") window.location.assign("/login");
}

export async function apiGet<T>(url: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : {});
  } catch {
    return { ok: false, error: "Нет соединения с сервером." };
  }
  if (!response.ok) {
    redirectOnUnauthorized(response.status);
    return { ok: false, error: await apiErrorMessage(response, "Не удалось загрузить данные.") };
  }
  try {
    return { ok: true, data: await response.json() as T };
  } catch {
    return { ok: false, error: "Сервер вернул некорректный ответ." };
  }
}

export async function apiSend<T>(url: string, init: RequestInit, failMessage: string): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return { ok: false, error: "Нет соединения с сервером." };
  }
  if (!response.ok) {
    redirectOnUnauthorized(response.status);
    return { ok: false, error: await apiErrorMessage(response, failMessage) };
  }
  return { ok: true, data: await response.json().catch(() => ({})) as T };
}

export function apiUpload<T>(url: string, body: FormData, failMessage: string, onProgress?: (progress: UploadProgress) => void, signal?: AbortSignal): Promise<ApiResult<T>> {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let total = 0;
    const finish = (result: ApiResult<T>) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    if (signal?.aborted) { finish({ ok: false, error: "Загрузка отменена." }); return; }
    xhr.open("POST", url);
    xhr.responseType = "text";
    xhr.upload.onprogress = event => {
      if (!event.lengthComputable) return;
      total = event.total;
      onProgress?.({ loaded: event.loaded, total: event.total, percent: Math.min(100, Math.round((event.loaded / event.total) * 100)) });
    };
    xhr.onload = () => {
      let data: unknown = {};
      try { data = JSON.parse(xhr.responseText) as unknown; } catch {  }
      const payload = data && typeof data === "object" ? data as ApiError : {};
      if (xhr.status >= 200 && xhr.status < 300) {
        if (total) onProgress?.({ loaded: total, total, percent: 100 });
        finish({ ok: true, data: data as T });
      } else {
        redirectOnUnauthorized(xhr.status);
        finish({ ok: false, error: typeof payload.error === "string" && payload.error ? payload.error : failMessage });
      }
    };
    xhr.onerror = () => finish({ ok: false, error: "Нет соединения с сервером." });
    xhr.onabort = () => finish({ ok: false, error: "Загрузка отменена." });
    if (signal) signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

export function apiJson<T>(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body: unknown, failMessage: string): Promise<ApiResult<T>> {
  return apiSend<T>(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, failMessage);
}

export async function apiMutate(url: string, init: RequestInit, failMessage: string): Promise<ApiResult<undefined>> {
  const result = await apiSend<unknown>(url, init, failMessage);
  return result.ok ? { ok: true, data: undefined } : result;
}

export async function apiJsonMutate(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body: unknown, failMessage: string): Promise<ApiResult<undefined>> {
  const result = await apiJson<unknown>(url, method, body, failMessage);
  return result.ok ? { ok: true, data: undefined } : result;
}
