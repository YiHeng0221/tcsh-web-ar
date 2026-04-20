import { Link, useLocation } from "react-router-dom";

/**
 * 404 shell. Kept small on purpose — shows the path the user landed on so
 * stale share links and typos are debuggable instead of silently redirecting
 * to `/` (which used to hide the problem).
 */
export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <main className="safe-area mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-5xl font-semibold text-muted">404</p>
      <p className="text-sm text-muted">
        No route matches <code className="rounded bg-surface px-2 py-0.5 text-fg">{pathname}</code>
      </p>
      <Link to="/" className="text-sm text-accent hover:text-accent-strong">
        ← Back to landing
      </Link>
    </main>
  );
}
