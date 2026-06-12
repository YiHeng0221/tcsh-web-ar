/**
 * Small typed fetch wrapper for API calls.
 *
 * Intentionally un-fancy: no axios, no openapi-fetch, no runtime validation.
 * The OpenAPI types from `./types.ts` give us compile-time shape correctness
 * and TanStack Query handles retries / caching.
 *
 * Auth model (post-Supabase migration, 2026-04):
 *   - The backend issues local JWTs from `POST /auth/login`. We persist the
 *     token via the helpers in `@/modes/c/lib/auth` (`localStorage` under
 *     `tcsh.auth.token`).
 *   - Every request here pulls the token via `getAuthToken()` and attaches
 *     `Authorization: Bearer <token>` when it exists. Mode A / B don't write
 *     to the API, so an absent token is fine — only mutating routes need it.
 *   - A 401 response means the token is gone or expired. We clear the
 *     persisted session and dispatch the same-tab auth event so
 *     `useAuthSession` flips to `unauthenticated` and the C1 login screen
 *     mounts. We don't hard-redirect here — the router handles that on
 *     the next render once auth state changes.
 *
 * The auth helpers are imported lazily inside the 401 path to keep this
 * module free of cross-module init order surprises (auth.ts imports
 * `apiPost` from here).
 */

// Import only the string constants from auth.ts — not any functions —
// to avoid the circular import that arises from auth.ts importing apiPost
// from this file. The constants are stable primitive values; importing
// them here means a single edit in auth.ts is enough to update both paths.
import { AUTH_EVENT, EMAIL_KEY, TOKEN_KEY } from "@/lib/api/authConstants";

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
  /**
   * Body override for non-JSON payloads (e.g. multipart `FormData`). When
   * set, `body` is sent as-is and we *don't* set a `content-type` header —
   * the browser fills in the multipart boundary.
   */
  rawBody?: BodyInit;
  /**
   * Skip the auto-attached Authorization header for this call. Useful for
   * the login endpoint itself (no token to send yet) and a future
   * `/auth/refresh` if we add one.
   */
  skipAuth?: boolean;
};

/**
 * Read the persisted access token. Uses the canonical TOKEN_KEY from
 * auth.ts to stay in sync with `getAccessToken()` — a single source of
 * truth for the localStorage key name.
 */
function readAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Wipe the persisted session on a 401 and notify any mounted
 * `useAuthSession` listeners. Uses the canonical KEY / EVENT constants
 * from auth.ts so renaming them in one place is enough — no silent drift.
 *
 * Note: we don't call `clearSession()` from auth.ts directly because auth.ts
 * imports `apiPost` from this file, which would create a circular module
 * dependency. Importing only the three string constants avoids that cycle.
 */
function handleUnauthorized(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(EMAIL_KEY);
  } catch {
    // ignore
  }
  // Same-tab signal — `useAuthSession` listens for this and re-validates.
  window.dispatchEvent(new CustomEvent(AUTH_EVENT));
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: RequestOptions,
): Promise<T> {
  // Build Headers via the constructor so Headers / string[][] / Record all
  // work; plain spread on `init.headers` silently drops non-Record values.
  const headers = new Headers(opts?.headers);

  const usingRawBody = opts?.rawBody !== undefined;
  if (!usingRawBody && body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  // Attach Authorization automatically — most Mode C calls need it; the few
  // that don't (login) opt out via `skipAuth`.
  if (!opts?.skipAuth && !headers.has("authorization")) {
    const token = readAuthToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: usingRawBody
      ? opts?.rawBody
      : body === undefined
        ? undefined
        : JSON.stringify(body),
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

    if (res.status === 401) {
      // Token rejected — drop the local session so the UI bounces to login.
      // The login endpoint itself opts out via `skipAuth`, so a 401 from
      // /auth/login still surfaces as `Invalid credentials` to the form
      // instead of clobbering an unrelated session.
      if (!opts?.skipAuth) handleUnauthorized();
    }

    throw new ApiError(res.status, `${res.status} ${message}`, detail);
  }

  // 204 No Content — common for DELETE
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string, opts?: RequestOptions) =>
  request<T>("GET", path, undefined, opts);
// `skipAuth` is opt-in at the call site (see `signIn`) — a path-based
// default would silently misfire if `/auth/refresh` or a different
// prefix landed later.
export const apiPost = <T>(path: string, body: unknown, opts?: RequestOptions) =>
  request<T>("POST", path, body, opts);
export const apiPatch = <T>(path: string, body: unknown, opts?: RequestOptions) =>
  request<T>("PATCH", path, body, opts);
export const apiDelete = (path: string, opts?: RequestOptions) =>
  request<void>("DELETE", path, undefined, opts);
