type ApiError = { error?: unknown };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({}) as ApiError);
  const error = (data as ApiError).error;
  return typeof error === "string" && error ? error : fallback;
}

export async function apiGet<T>(url: string, fallback: T, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, signal ? { signal } : {}).catch(() => null);
  if (!response?.ok) return fallback;
  return await response.json().catch(() => fallback) as T;
}

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
