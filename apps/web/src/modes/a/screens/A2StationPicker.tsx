import { Link } from "react-router-dom";

/** Placeholder for issue #12 — Station Picker. */
export default function A2StationPicker() {
  return (
    <main
      data-mode="a"
      data-screen="a2"
      className="safe-area flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <h1 className="text-xl font-semibold">A2 · Station Picker</h1>
      <p className="text-sm text-muted">Scaffolded. Screen content lands in #12.</p>
      <div className="flex gap-4 text-sm">
        <Link to="/a/permission" className="text-muted hover:text-fg">
          ← back to A1
        </Link>
        <Link to="/a/scan/station-a" className="text-accent">
          → A3 scan (preview) →
        </Link>
      </div>
    </main>
  );
}
