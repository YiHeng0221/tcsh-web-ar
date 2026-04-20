import { Link, useParams } from "react-router-dom";

/** Placeholder for issue #14 — AR viewing main surface (A4/A5/A6 flow). */
export default function A4ARViewing() {
  const { stationId } = useParams<{ stationId: string }>();
  return (
    <main
      data-mode="a"
      data-screen="a4"
      // safe-area intentionally on the placeholder so the scaffolding text
      // doesn't hide under the iOS notch. The #14 implementation swaps in
      // a fullbleed camera + R3F canvas and drops this class.
      className="safe-area flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <h1 className="text-xl font-semibold">A4 · AR Viewing</h1>
      <p className="text-sm text-muted">
        Station: <code className="rounded bg-surface px-2 py-0.5 text-fg">{stationId}</code>
      </p>
      <p className="text-xs text-muted">
        Scaffolded. Fullbleed camera + world-locked R3F render lands in #14;
        object drawer in #15, next-station guide in #16.
      </p>
      <Link to="/a/stations" className="text-sm text-accent">
        ← A2 stations
      </Link>
    </main>
  );
}
