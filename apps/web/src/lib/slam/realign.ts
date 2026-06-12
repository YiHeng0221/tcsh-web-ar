/**
 * Re-alignment jitter guard for the SLAM walking-AR view (spec §3).
 *
 * In `viewing`, the QR decode loop keeps running at ~2 fps. Every time a QR
 * re-enters frame and `solveSquarePose` produces a trustworthy pose
 * (reproj ≤ accept threshold), we recompute `T_slam←anchor` and snap the
 * anchor group to it — this is how accumulated SLAM drift is wiped out without
 * a full re-scan.
 *
 * But a momentary occlusion / motion-blur frame can still squeak under the
 * reproj gate with a pose that's subtly wrong; snapping to it would jerk the
 * whole scene. So we apply the SAME jitter-guard rule `PoseFusion` uses for the
 * QR+IMU path (`lib/ar/pose-fusion.ts` §6 rule 4), factored out here as a pure,
 * testable accumulator:
 *
 *   - Keep a short history of recent accepted reproj errors.
 *   - A solve whose reproj error exceeds `factor × median(history)` is an
 *     outlier. The FIRST two consecutive outliers are dropped (treated as a
 *     glitch). The THIRD consecutive outlier is accepted — three in a row means
 *     the scene genuinely changed (the user walked to a new angle) and the
 *     history needs to re-baseline, not that one frame glitched.
 *   - A solve at or under the threshold resets the outlier run and is accepted.
 *
 * Pure data in / data out: no three.js, no XR8, no DOM. The caller owns the
 * actual `T` recompute + group snap; this only decides accept/reject.
 */

/** Reproj error (px) above this is never trusted, regardless of the guard. */
export const REALIGN_ACCEPT_REPROJ_PX = 8;
/** A solve whose reproj exceeds this multiple of the recent median is an
 *  outlier (mirrors `JITTER_REPROJ_FACTOR` in pose-fusion). */
export const REALIGN_JITTER_FACTOR = 2;
/** Consecutive outliers required before one is force-accepted (re-baseline). */
export const REALIGN_OUTLIER_RUN = 3;
/** Recent accepted reproj errors kept for the median. */
const REPROJ_HISTORY = 5;

export type RealignDecision = {
  /** Whether the caller should recompute `T` and snap the anchor group. */
  accept: boolean;
  /** Why it was rejected (for HUD / tests); null when accepted. */
  reason: "above-threshold" | "jitter-outlier" | null;
};

/**
 * Stateful jitter guard for continuous re-alignment. Construct once per
 * `viewing` session; feed each solve's reproj error to `offer()`. Reset (via
 * a fresh instance) when re-entering `scanning`.
 */
export class RealignGuard {
  private reprojHistory: number[] = [];
  private consecutiveOutliers = 0;

  constructor(
    private readonly acceptReprojPx: number = REALIGN_ACCEPT_REPROJ_PX,
    private readonly jitterFactor: number = REALIGN_JITTER_FACTOR,
    private readonly outlierRun: number = REALIGN_OUTLIER_RUN,
  ) {}

  /**
   * Offer a solve's reprojection error. Returns the accept/reject decision and
   * mutates the internal history only on acceptance (so dropped glitch frames
   * never poison the median).
   */
  offer(reprojErrorPx: number): RealignDecision {
    // Hard ceiling first: a solve worse than the accept threshold is never
    // trusted, and never counts toward the outlier run (it's not "the scene
    // changed", it's just a bad solve).
    if (reprojErrorPx > this.acceptReprojPx) {
      return { accept: false, reason: "above-threshold" };
    }

    // Jitter guard against the recent median. First solves (empty history) are
    // always trusted so the guard has something to baseline against.
    if (this.reprojHistory.length > 0) {
      const median = medianOf(this.reprojHistory);
      if (reprojErrorPx > this.jitterFactor * median) {
        this.consecutiveOutliers += 1;
        if (this.consecutiveOutliers < this.outlierRun) {
          // Drop, but don't record — keep the history clean.
          return { accept: false, reason: "jitter-outlier" };
        }
        // Nth consecutive outlier: the scene genuinely changed. Fall through
        // and accept, letting the history re-baseline below.
      } else {
        this.consecutiveOutliers = 0;
      }
    }

    this.record(reprojErrorPx);
    return { accept: true, reason: null };
  }

  /** Reset run + history (e.g. on manual re-aim back to scanning). */
  reset(): void {
    this.reprojHistory = [];
    this.consecutiveOutliers = 0;
  }

  /**
   * Seed the history with the FIRST accepted alignment (the scanning→viewing
   * lock), so continuous re-align in `viewing` has a median to compare against
   * from frame one. The first lock is trusted unconditionally upstream, so this
   * just records — it doesn't run the guard.
   */
  seed(reprojErrorPx: number): void {
    if (reprojErrorPx > this.acceptReprojPx) return;
    this.record(reprojErrorPx);
  }

  private record(reprojErrorPx: number): void {
    this.consecutiveOutliers = 0;
    this.reprojHistory.push(reprojErrorPx);
    if (this.reprojHistory.length > REPROJ_HISTORY) this.reprojHistory.shift();
  }
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
