import { Link } from "react-router-dom";

/**
 * Mode B entry — handheld 3D viewer of the full textured artwork. B1–B4
 * screens arrive in issues #18–#22; the 3D scene setup lives in
 * `src/lib/3d/`.
 */
export default function ModeBRoot() {
  return (
    <div
      data-mode="b"
      className="safe-area flex min-h-dvh flex-col items-center justify-center gap-6 px-6"
    >
      <h1 className="text-2xl font-semibold">Mode B · 3D Viewer</h1>
      <p className="max-w-md text-center text-sm text-muted">
        Handheld 3D viewer. B1–B4 screens land in issues #18–#21, responsive
        layouts in #22.
      </p>
      <Link to="/" className="text-sm text-muted hover:text-fg">
        ← Back to landing
      </Link>
    </div>
  );
}
