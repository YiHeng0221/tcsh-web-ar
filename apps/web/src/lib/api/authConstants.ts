/**
 * Auth storage/event constants — extracted to their own module so
 * `lib/api/client.ts` and `modes/c/lib/auth.ts` can both import them
 * without importing each other. The previous circular import "worked"
 * only because client.ts touched nothing but module-level string
 * constants before auth.ts finished initialising — an invariant a
 * future maintainer could break without any warning.
 */
export const TOKEN_KEY = "tcsh.auth.token";
export const EMAIL_KEY = "tcsh.auth.email";
/** CustomEvent name dispatched on same-tab auth state changes. */
export const AUTH_EVENT = "tcsh:auth-changed";
