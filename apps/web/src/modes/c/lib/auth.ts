/**
 * Mode C · Local JWT auth client + helpers.
 *
 * The admin path (`/_studio/<token>`) is obscurity, not security — the real
 * gate is the JWT this module manages. The API verifies it on every mutating
 * call (see `apps/api/src/tcsh_ar_api/auth`); we just need to keep the token
 * fresh on the client and gate the UI on whether one exists.
 *
 * Storage:
 *   localStorage[`tcsh.auth.token`] — the raw access token (JWT).
 *   localStorage[`tcsh.auth.email`] — the email we logged in as, used for
 *     UI display + so AdminShell doesn't have to round-trip /auth/me on
 *     every render.
 *
 * Why localStorage and not sessionStorage / cookies?
 *   - Mode C is a single-tab admin tool; persistence across reloads matters
 *     more than tab isolation.
 *   - The API expects `Authorization: Bearer <token>`, not a cookie, so
 *     CSRF risk via cookies isn't on the table.
 *   - We don't run third-party scripts inside Mode C (no analytics, no
 *     pixels) — the XSS surface is what we author.
 *
 * The Supabase SDK is intentionally gone — the backend now issues local
 * JWTs from `POST /auth/login` and validates them on every protected route.
 */
import { useEffect, useState } from "react";

import { apiGet, apiPost, ApiError } from "@/lib/api/client";

// ── Storage keys --------------------------------------------------------
// Exported so `client.ts` can import the canonical values rather than
// maintaining a hand-rolled mirror. Only constants are exported from here
// to `client.ts` — not functions — to avoid the circular import that
// would arise if `client.ts` pulled `clearSession()` (which calls
// `notifyAuthChanged()`, which uses `AUTH_EVENT` from this file, which
// imports `apiPost` from `client.ts`).

export { AUTH_EVENT, EMAIL_KEY, TOKEN_KEY } from "@/lib/api/authConstants";
import { AUTH_EVENT, EMAIL_KEY, TOKEN_KEY } from "@/lib/api/authConstants";

// ── Wire types ---------------------------------------------------------

interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface MeResponse {
  email: string;
  is_admin: boolean;
}

// ── Token storage helpers ----------------------------------------------

/**
 * Read the persisted access token. Returns `null` if unset or if we're
 * running in a non-browser context (SSR / tests with no `localStorage`).
 */
export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function getStoredEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

function writeSession(token: string, email: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(EMAIL_KEY, email);
  } catch {
    // localStorage can throw in private mode / over-quota — surface as a
    // login failure rather than a silent broken session.
    throw new Error("無法儲存登入狀態（localStorage 不可用）");
  }
}

/**
 * Wipe the persisted session and broadcast the auth-changed event.
 *
 * Exported so non-`client.ts` code paths (e.g. C4's XHR upload) can hook
 * into the same teardown the global 401 handler uses — without that,
 * a token expiring during a multipart upload would leave a zombie session
 * in localStorage until the next regular `apiPost` saw a 401.
 */
export function clearSession(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(EMAIL_KEY);
  } catch {
    // Best-effort; nothing useful we can do if removeItem throws.
  }
  // Notify any in-flight `useAuthSession` instances. localStorage's native
  // `storage` event only fires across *other* tabs, so we synthesise a
  // local CustomEvent for same-tab listeners.
  notifyAuthChanged();
}

// Same-tab broadcast channel for auth state changes. The `storage` event
// natively only fires in other tabs/windows, so we layer a CustomEvent on
// top of it for components mounted in the same tab as signIn/signOut.
// Exported so `client.ts` can dispatch the same event name without a
// hand-rolled duplicate constant.

function notifyAuthChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_EVENT));
}

// ── Public API --------------------------------------------------------

export interface SignInArgs {
  email: string;
  password: string;
}

/**
 * Sentinel error subclass surfaced when the API rejected the login as
 * unauthorised. C1 catches this directly via `instanceof InvalidCredentialsError`
 * instead of regex-matching error messages — message strings are not a
 * stable contract with the backend and would silently drift if the API
 * ever rephrases its 401 body.
 */
export class InvalidCredentialsError extends Error {
  constructor(message = "Invalid login credentials") {
    super(message);
    this.name = "InvalidCredentialsError";
  }
}

/**
 * Trade an email + password for a JWT and persist it. Throws on failure
 * (caller surfaces the error in the C1 form). On success the auth event
 * fires synchronously so `useAuthSession` listeners flip to `authenticated`
 * without a manual refetch.
 *
 * The `/auth/login` POST opts out of auto-auth via `skipAuth: true` so a
 * stale session token never gets attached to a fresh login attempt. This
 * also means a 401 here goes straight to InvalidCredentialsError without
 * the global handler clobbering any other already-good session.
 */
export async function signIn({ email, password }: SignInArgs): Promise<void> {
  let res: LoginResponse;
  try {
    res = await apiPost<LoginResponse>(
      "/auth/login",
      { email, password },
      { skipAuth: true },
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw new InvalidCredentialsError();
    }
    throw err;
  }
  if (!res.access_token) {
    throw new Error("登入失敗：未取得 access_token");
  }
  writeSession(res.access_token, email);
  notifyAuthChanged();
}

/**
 * Drop the persisted token + email. No network call — the backend issues
 * stateless JWTs, so signing out is purely client-side. If we ever add a
 * `/auth/logout` endpoint (e.g. server-side blocklist), do the network
 * call here and clear the session in `finally`.
 */
export async function signOut(): Promise<void> {
  clearSession();
}

// ── React hook -------------------------------------------------------

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthState {
  status: AuthStatus;
  /** Email of the logged-in admin, if any. */
  email: string | null;
  signOut: () => Promise<void>;
}

/**
 * Source-of-truth React hook for Mode C auth state.
 *
 * Lifecycle:
 *   1. Mount → `loading` while we read the persisted token.
 *   2. No token → `unauthenticated`.
 *   3. Token present → call `GET /auth/me` to validate. On 200 → `authenticated`.
 *      On 401 → clear the token and flip to `unauthenticated`.
 *   4. Listen for the same-tab `tcsh:auth-changed` event + the cross-tab
 *      native `storage` event so a sign-in / sign-out in another tab updates
 *      this hook's state without a refresh.
 *
 * The validation hop is cheap (one JSON GET) and runs on every Mode C entry
 * — that's the right trade for a tool that admins reload all the time and
 * where stale tokens silently breaking things would be confusing.
 */
export function useAuthSession(): AuthState {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [email, setEmail] = useState<string | null>(() => getStoredEmail());

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const token = getAccessToken();
      if (!token) {
        if (cancelled) return;
        setStatus("unauthenticated");
        setEmail(null);
        return;
      }

      try {
        const me = await apiGet<MeResponse>("/auth/me");
        if (cancelled) return;
        // Trust the server's email over the cached one — it's the
        // canonical source if the backend ever rotates emails.
        setEmail(me.email);
        try {
          window.localStorage.setItem(EMAIL_KEY, me.email);
        } catch {
          // ignore
        }
        setStatus("authenticated");
      } catch (err) {
        if (cancelled) return;
        // 401 → token expired / revoked. Clear and bounce to login.
        // Other errors (network, 5xx) → keep the token so a flaky network
        // doesn't log the user out; show as unauthenticated for this render
        // and the next mount will try again.
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
        }
        setStatus("unauthenticated");
        setEmail(null);
      }
    }

    void refresh();

    function onAuthChanged() {
      // Reset to `loading` so consumers see a clean transition rather than
      // a flash of "unauthenticated" between sign-in and validation.
      setStatus("loading");
      void refresh();
    }

    function onStorage(e: StorageEvent) {
      if (e.key === TOKEN_KEY || e.key === null) {
        onAuthChanged();
      }
    }

    window.addEventListener(AUTH_EVENT, onAuthChanged);
    window.addEventListener("storage", onStorage);

    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_EVENT, onAuthChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return { status, email, signOut };
}
