/**
 * Scan reticle — the framing overlay drawn over the live camera while the
 * ARView state machine is in `scanning` (spec §0.5: "取景框提示『對準地面的
 * QR』"). Pure presentation; it owns no camera / detection state.
 *
 * Visual states:
 *   - `preparing` — camera open but OpenCV WASM still downloading. Corners
 *     dimmed, status line says we're getting ready.
 *   - `scanning`  — corners breathe (CSS animation) to read as "looking".
 *   - `locked`    — a station QR solved cleanly; corners snap green just
 *     before the AR content fades in (gives the lock a beat of feedback).
 */

export type ReticleState = "preparing" | "scanning" | "locked";

const CORNER_BASE =
  "absolute h-9 w-9 border-accent transition-colors duration-200";

export default function ScanReticle({
  state,
  hint,
}: {
  state: ReticleState;
  hint: string;
}) {
  const locked = state === "locked";
  const dimmed = state === "preparing";
  const colorClass = locked
    ? "border-emerald-400 text-emerald-300"
    : "border-accent text-accent";

  return (
    <div
      data-reticle-state={state}
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
    >
      <div
        className={[
          "relative h-60 w-60 max-w-[70vw]",
          state === "scanning" ? "animate-[reticle-breathe_2.4s_ease-in-out_infinite]" : "",
          dimmed ? "opacity-40" : "opacity-100",
        ].join(" ")}
      >
        {/* Four L-shaped corner brackets. */}
        <span className={`${CORNER_BASE} ${colorClass} left-0 top-0 border-l-2 border-t-2 rounded-tl-lg`} />
        <span className={`${CORNER_BASE} ${colorClass} right-0 top-0 border-r-2 border-t-2 rounded-tr-lg`} />
        <span className={`${CORNER_BASE} ${colorClass} bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg`} />
        <span className={`${CORNER_BASE} ${colorClass} bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg`} />
      </div>

      <p
        className={`mt-8 max-w-[80vw] text-center text-sm ${
          locked ? "text-emerald-300" : "text-fg/90"
        }`}
      >
        {hint}
      </p>

      {/* Local keyframes — kept inline so the component is self-contained and
          doesn't depend on a Tailwind config animation entry. */}
      <style>{`
        @keyframes reticle-breathe {
          0%, 100% { transform: scale(1); opacity: 0.9; }
          50% { transform: scale(1.04); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
