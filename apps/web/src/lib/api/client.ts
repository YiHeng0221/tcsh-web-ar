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
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = {
  /** Forwarded to fetch so TanStack Query can cancel in-flight requests. */
  signal?: AbortSignal;
  /** Optional extra headers. Merged into fetch's Headers. */
  headers?: HeadersInit;
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: RequestOptions,
): Promise<T> {
  // Build Headers via the constructor so Headers / string[][] / Record all
  // work; plain spread on `init.headers` silently drops non-Record values.
  const headers = new Headers(opts?.headers);
  if (body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: opts?.signal,
  });

  if (!res.ok) {
    // Prefer a structured `{ detail }` from FastAPI over raw text; fall
    // back to text so a gateway / non-JSON error still yields a message.
    let detail: unknown;
    let message = res.statusText;
    try {
      const parsed = await res.clone().json();
      detail = parsed;
      if (parsed && typeof parsed === "object" && "detail" in parsed) {
        const d = (parsed as { detail: unknown }).detail;
        if (typeof d === "string") message = d;
      }
    } catch {
      const text = await res.text().catch(() => "");
      if (text) message = text;
    }
    throw new ApiError(res.status, `${res.status} ${message}`, detail);
  }

  // 204 No Content — common for DELETE
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string, opts?: RequestOptions) =>
  request<T>("GET", path, undefined, opts);
export const apiPost = <T>(path: string, body: unknown, opts?: RequestOptions) =>
  request<T>("POST", path, body, opts);
export const apiPatch = <T>(path: string, body: unknown, opts?: RequestOptions) =>
  request<T>("PATCH", path, body, opts);
export const apiDelete = (path: string, opts?: RequestOptions) =>
  request<void>("DELETE", path, undefined, opts);
