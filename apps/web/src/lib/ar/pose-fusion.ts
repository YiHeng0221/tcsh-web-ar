/**
 * Pose fusion — the heart of the tracking strategy (spec §6 pose-fusion).
 *
 * The one external source of camera pose for Mode A. It fuses two inputs:
 *
 *   - QR solvePnP pose: ground truth. When a solve lands (reproj OK), we
 *     SNAP straight to it (no filtering — at a station the user is standing
 *     still, so filtering's latency hurts more than its smoothing helps).
 *   - IMU quaternion: fills the gaps. When the QR isn't in frame, the IMU's
 *     rotation *delta* since the last QR snap is layered onto the last QR
 *     orientation. Position is FROZEN at the last QR solve — we never
 *     integrate the accelerometer (spec forbids it; the user is assumed
 *     stationary).
 *
 * Three-state machine:
 *   acquiring — no valid QR pose yet.
 *   tracking  — QR solved within the last 2s.
 *   coasting  — QR lost > 2s; IMU-only rotation, position frozen.
 *
 * After > 10s of coasting we raise the recalibration signal so the UI can
 * prompt "請對準地面的 QR 重新校準".
 */

import { Quaternion, Vector3 } from "three";

export type FusionState = "acquiring" | "tracking" | "coasting";

export type FusedPose = {
  position: Vector3;
  quaternion: Quaternion;
  state: FusionState;
  /** True once coasting has exceeded the recalibration grace period. */
  needsRecalibration: boolean;
};

export type QrSample = {
  position: Vector3;
  quaternion: Quaternion;
  reprojErrorPx: number;
};

/** QR lost longer than this (ms) → leave `tracking` for `coasting`. */
export const COASTING_AFTER_MS = 2_000;
/** Coasting longer than this (ms) → raise recalibration prompt. */
export const RECALIBRATE_AFTER_MS = 10_000;
/** Jitter guard: a frame whose reproj error exceeds this multiple of the
 *  recent median is treated as an occlusion-glitch solve and dropped. */
export const JITTER_REPROJ_FACTOR = 2;
/** Number of recent solves kept for the median-based jitter guard. */
const REPROJ_HISTORY = 5;

export class PoseFusion {
  private state: FusionState = "acquiring";

  // Last accepted QR ground truth.
  private poseRefPosition = new Vector3();
  private poseRefQuat = new Quaternion();
  /** IMU quaternion captured at the instant of the last QR snap. */
  private imuRefQuat = new Quaternion();
  private lastQrAt = -Infinity;

  // Latest IMU reading.
  private imuNow = new Quaternion();
  private haveImu = false;

  // Jitter guard: recent reproj errors + run of consecutive outliers.
  private reprojHistory: number[] = [];
  private consecutiveOutliers = 0;

  /** Whether any IMU reading has arrived (field HUD: a dead sensor stream
   *  freezes coasting rotation — see 2026-06-13 iOS re-grant quirk). */
  get hasImu(): boolean {
    return this.haveImu;
  }

  /** Feed the current IMU orientation (call from the IMU subscription). */
  setImu(q: Quaternion): void {
    this.imuNow.copy(q);
    this.haveImu = true;
  }

  /**
   * Offer a QR solve. Returns true if accepted (snapped), false if dropped
   * by the jitter guard. `now` is injectable for deterministic tests.
   */
  pushQrPose(sample: QrSample, now: number = Date.now()): boolean {
    // Jitter guard (spec §6 rule 4): if reproj error spikes > 2× the recent
    // median for 3 consecutive frames, drop — it's a bad solve from a
    // momentary occlusion. The first solves (no history) are always trusted.
    if (this.reprojHistory.length > 0) {
      const median = medianOf(this.reprojHistory);
      if (sample.reprojErrorPx > JITTER_REPROJ_FACTOR * median) {
        this.consecutiveOutliers += 1;
        if (this.consecutiveOutliers < 3) {
          return false; // drop, but don't yet poison the history
        }
        // 3rd consecutive outlier: the scene genuinely changed (user moved
        // to a new angle). Accept it and let the history re-baseline.
      } else {
        this.consecutiveOutliers = 0;
      }
    }

    // Accept: snap pose and record reference frames.
    this.poseRefPosition.copy(sample.position);
    this.poseRefQuat.copy(sample.quaternion);
    this.imuRefQuat.copy(this.haveImu ? this.imuNow : IDENTITY);
    this.lastQrAt = now;
    this.state = "tracking";

    this.reprojHistory.push(sample.reprojErrorPx);
    if (this.reprojHistory.length > REPROJ_HISTORY) this.reprojHistory.shift();

    return true;
  }

  /**
   * Compute the fused pose for this frame. `now` injectable for tests.
   */
  getPose(now: number = Date.now()): FusedPose {
    const sinceQr = now - this.lastQrAt;

    if (this.state === "acquiring") {
      return {
        position: this.poseRefPosition.clone(),
        quaternion: this.poseRefQuat.clone(),
        state: "acquiring",
        needsRecalibration: false,
      };
    }

    // Transition tracking → coasting once the QR has been gone > 2s.
    if (sinceQr > COASTING_AFTER_MS) {
      this.state = "coasting";
    }

    // Orientation: last QR orientation, with the IMU delta since the snap
    // layered on top:  q = poseRefQuat · (imuRefQuat⁻¹ · imuNow).
    const quaternion = this.poseRefQuat.clone();
    if (this.haveImu) {
      const delta = this.imuRefQuat.clone().invert().multiply(this.imuNow);
      quaternion.multiply(delta);
    }

    // Position is always frozen at the last QR solve (no accel integration).
    const position = this.poseRefPosition.clone();

    const needsRecalibration =
      this.state === "coasting" && sinceQr > RECALIBRATE_AFTER_MS;

    return { position, quaternion, state: this.state, needsRecalibration };
  }

  /** Current state (read-only) — handy for UI and tests. */
  getState(): FusionState {
    return this.state;
  }
}

const IDENTITY = new Quaternion();

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
