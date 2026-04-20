import { Link, useParams } from "react-router-dom";

/** Placeholder for issue #13 — QR scan + solvePnP pose recovery. */
export default function A3QRScan() {
  const { stationId } = useParams<{ stationId: string }>();
  return (
    <main
      data-mode="a"
      data-screen="a3"
      className="safe-area flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <h1 className="text-xl font-semibold">A3 · QR Scan</h1>
      <p className="text-sm text-muted">
        Station: <code className="rounded bg-surface px-2 py-0.5 text-fg">{stationId}</code>
      </p>
      <p className="text-xs text-muted">
        Scaffolded. QR + solvePnP pipeline lands in #13.
      </p>
      <div className="flex gap-4 text-sm">
        <Link to="/a/stations" className="text-muted hover:text-fg">
          ← back
        </Link>
        <Link to={`/a/view/${stationId ?? "station-a"}`} className="text-accent">
          → A4 view →
        </Link>
      </div>
    </main>
  );
}
