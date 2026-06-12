/**
 * Recalibrate toast — surfaced when pose-fusion has been `coasting` past its
 * grace period (spec §0.5 / §6: ">10s → RecalibrateToast"). Tells the visitor
 * the AR has drifted off ground truth and asks them to re-aim at a floor QR so
 * the next solvePnP snap zeroes the drift.
 *
 * Pure presentation; the parent decides visibility from
 * `FusedPose.needsRecalibration`.
 */
export default function RecalibrateToast({ visible }: { visible: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "pointer-events-none absolute inset-x-0 bottom-28 flex justify-center px-4",
        "transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 rounded-full bg-black/75 px-4 py-2 text-sm text-fg backdrop-blur">
        <span aria-hidden>🎯</span>
        <span>請對準地面的 QR 重新校準</span>
      </div>
    </div>
  );
}
