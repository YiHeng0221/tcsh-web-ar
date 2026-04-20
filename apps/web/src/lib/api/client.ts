/**
 * Small typed fetch wrapper for API calls.
 *
 * Intentionally un-fancy: no axios, no openapi-fetch, no runtime validation.
 * The OpenAPI types from `./types.ts` give us compile-time shape correctness
 * and TanStack Query handles retries / caching. When we need auth headers
 * for Mode C, add an interceptor here rather than passing it through every
 * call site.
 */

const BASE = "/api";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, `${res.status} ${detail}`);
  }
  // 204 No Content — common for DELETE
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string) => request<T>(path, { method: "GET" });
export const apiPost = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
export const apiPatch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const apiDelete = (path: string) =>
  request<void>(path, { method: "DELETE" });
