/**
 * IMU rotation source: `DeviceOrientationEvent` → three.js `Quaternion`
 * (spec §6 imu).
 *
 * Role in the pipeline: between QR reads, pose-fusion needs the device's
 * *rotation delta* to keep the camera orientation live. We deliberately use
 * the RELATIVE orientation reading (alpha/beta/gamma without compass): an
 * absolute/compass heading is both unreliable indoors-outdoors and
 * unnecessary, because every QR re-solve snaps the absolute orientation
 * back to ground truth (spec §6 rule 1). So IMU only has to be locally
 * consistent, not globally north-aligned.
 *
 * Screen-orientation: we assume portrait lock. On `orientationchange` we do
 * NOT try to compensate into landscape — that's a UX-simplification
 * decision (recorded in the PR body); instead the consumer is signalled to
 * re-prompt the user to rescan. We still apply the portrait screen-angle
 * offset so a device that reports a non-zero `screen.orientation.angle`
 * while nominally portrait stays correct.
 *
 * iOS permission: this module does NOT request permission. The
 * `DeviceOrientationEvent.requestPermission()` gate is owned by
 * `permissions.ts`, called from the A1 user-gesture handler. By the time
 * A3/A4 start an `ImuTracker`, the grant already exists (spec §6: "沿用
 * permissions.ts 既有 pattern，不要重新實作").
 */

import { Euler, Quaternion } from "three";

// three's deviceorientation→quaternion convention: the sensor frame has Z
// up, and we rotate into three's Y-up world. This −π/2 about X aligns them
// (the same constant three's deprecated DeviceOrientationControls used).
const ZEE = { x: 0, y: 0, z: 1 } as const;

const _euler = new Euler();
const _q0 = new Quaternion();
// −π/2 around X, applied as a fixed post-rotation.
const _qFix = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

/**
 * Convert raw alpha/beta/gamma (degrees) + screen angle (degrees) into a
 * three.js Quaternion. Pure function — exported for testing.
 */
export function orientationToQuaternion(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg: number,
): Quaternion {
  const alpha = (alphaDeg * Math.PI) / 180; // Z
  const beta = (betaDeg * Math.PI) / 180; // X'
  const gamma = (gammaDeg * Math.PI) / 180; // Y''
  const orient = (screenAngleDeg * Math.PI) / 180;

  // 'YXZ' intrinsic — the order the W3C DeviceOrientation spec composes
  // alpha (Z), beta (X), gamma (Y).
  _euler.set(beta, alpha, -gamma, "YXZ");
  const q = new Quaternion().setFromEuler(_euler);
  q.multiply(_qFix); // camera looks out the back of the device
  // Compensate for screen rotation about its viewing axis (Z up).
  q.multiply(_q0.setFromAxisAngle(ZEE, -orient));
  return q;
}

type DeviceOrientationLike = {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
};

export type ImuTrackerCallbacks = {
  /** Latest device orientation as a three quaternion (relative frame). */
  onQuaternion: (q: Quaternion) => void;
  /** Fired on `orientationchange`: consumer should prompt a rescan rather
   *  than attempt landscape compensation (UX-simplification, spec §6). */
  onOrientationChange?: () => void;
};

/**
 * Live IMU tracker. Subscribes to `deviceorientation` (and
 * `orientationchange`) and pushes quaternions to the callback. Caller MUST
 * call `dispose()` on unmount — dangling sensor listeners are a documented
 * iOS leak (REVIEW.md).
 *
 * Permission must already be granted (see module header); this constructor
 * does not prompt.
 */
export class ImuTracker {
  private readonly cb: ImuTrackerCallbacks;
  private disposed = false;

  constructor(cb: ImuTrackerCallbacks) {
    this.cb = cb;
    if (typeof window !== "undefined") {
      window.addEventListener("deviceorientation", this.handleOrientation);
      window.addEventListener("orientationchange", this.handleScreenChange);
    }
  }

  private screenAngle(): number {
    if (typeof window === "undefined") return 0;
    const angle = window.screen?.orientation?.angle;
    return typeof angle === "number" ? angle : 0;
  }

  private handleOrientation = (event: DeviceOrientationLike): void => {
    if (this.disposed) return;
    if (event.alpha == null || event.beta == null || event.gamma == null) {
      return; // no usable reading yet
    }
    const q = orientationToQuaternion(
      event.alpha,
      event.beta,
      event.gamma,
      this.screenAngle(),
    );
    this.cb.onQuaternion(q);
  };

  private handleScreenChange = (): void => {
    if (this.disposed) return;
    this.cb.onOrientationChange?.();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("deviceorientation", this.handleOrientation);
      window.removeEventListener("orientationchange", this.handleScreenChange);
    }
  }
}
