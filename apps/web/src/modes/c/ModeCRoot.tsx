import { Link } from "react-router-dom";

/**
 * Mode C entry — creator admin for uploading textures and placing them on
 * objects. Path token is obscurity, not security: every mutating call still
 * verifies a Supabase JWT server-side (see `apps/api/src/tcsh_ar_api/auth`).
 * C1–C6 screens arrive in issues #24–#29; hidden route + token logic in #23.
 */
export default function ModeCRoot() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">Mode C · Creator Admin</h1>
      <p className="max-w-md text-center text-sm text-[color:var(--color-muted)]">
        Admin for texture uploads and placements. Hidden-route token gating
        lands in #23; C1–C6 screens in #24–#29.
      </p>
      <Link
        to="/"
        className="text-sm text-[color:var(--color-muted)] hover:text-[color:var(--color-fg)]"
      >
        ← Back to landing
      </Link>
    </div>
  );
}
