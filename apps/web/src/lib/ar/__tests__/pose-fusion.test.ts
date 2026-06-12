import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";

import {
  COASTING_AFTER_MS,
  PoseFusion,
  RECALIBRATE_AFTER_MS,
  type QrSample,
} from "../pose-fusion";

function sample(
  position: Vector3,
  quaternion: Quaternion,
  reprojErrorPx = 1,
): QrSample {
  return { position, quaternion, reprojErrorPx };
}

const ID = new Quaternion();

describe("PoseFusion state machine", () => {
  it("starts in acquiring with identity pose", () => {
    const f = new PoseFusion();
    const p = f.getPose(0);
    expect(p.state).toBe("acquiring");
    expect(p.needsRecalibration).toBe(false);
  });

  it("snaps directly to a QR solve (no filtering) and enters tracking", () => {
    const f = new PoseFusion();
    const pos = new Vector3(0.1, 1.0, 0.2);
    const quat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5);
    expect(f.pushQrPose(sample(pos, quat), 1000)).toBe(true);

    const p = f.getPose(1000);
    expect(p.state).toBe("tracking");
    expect(p.position.x).toBeCloseTo(0.1, 10);
    expect(p.position.y).toBeCloseTo(1.0, 10);
    expect(p.position.z).toBeCloseTo(0.2, 10);
    // No IMU fed → orientation is exactly the QR orientation.
    expect(quatDot(p.quaternion, quat)).toBeCloseTo(1, 10);
  });

  it("transitions tracking → coasting after 2s without QR", () => {
    const f = new PoseFusion();
    f.pushQrPose(sample(new Vector3(), ID), 0);
    expect(f.getPose(COASTING_AFTER_MS).state).toBe("tracking");
    expect(f.getPose(COASTING_AFTER_MS + 1).state).toBe("coasting");
  });

  it("freezes position while coasting (no accel integration)", () => {
    const f = new PoseFusion();
    const pos = new Vector3(0.5, 1.2, -0.3);
    f.pushQrPose(sample(pos, ID), 0);
    const p = f.getPose(5000); // well into coasting
    expect(p.state).toBe("coasting");
    expect(p.position.x).toBeCloseTo(0.5, 10);
    expect(p.position.y).toBeCloseTo(1.2, 10);
    expect(p.position.z).toBeCloseTo(-0.3, 10);
  });

  it("layers IMU delta onto the last QR orientation", () => {
    const f = new PoseFusion();
    // IMU reference at snap time = identity.
    f.setImu(new Quaternion());
    const qrQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3);
    f.pushQrPose(sample(new Vector3(), qrQuat), 0);

    // Device then yaws +0.2 rad → IMU now differs from the ref by that.
    const imuNow = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.2);
    f.setImu(imuNow);

    const p = f.getPose(500); // still tracking, no new QR this frame
    // Expected = qrQuat · (imuRef⁻¹ · imuNow) = qrQuat · imuNow (ref=identity).
    const expected = qrQuat.clone().multiply(imuNow);
    expect(quatDot(p.quaternion, expected)).toBeCloseTo(1, 10);
  });

  it("raises recalibration only after >10s of coasting", () => {
    const f = new PoseFusion();
    f.pushQrPose(sample(new Vector3(), ID), 0);
    expect(f.getPose(RECALIBRATE_AFTER_MS).needsRecalibration).toBe(false);
    expect(f.getPose(RECALIBRATE_AFTER_MS + 1).needsRecalibration).toBe(true);
  });

  it("re-snaps and clears coasting when a QR returns", () => {
    const f = new PoseFusion();
    f.pushQrPose(sample(new Vector3(1, 1, 1), ID), 0);
    expect(f.getPose(6000).state).toBe("coasting");

    const newPos = new Vector3(2, 1, 0);
    f.pushQrPose(sample(newPos, ID), 6000);
    const p = f.getPose(6000);
    expect(p.state).toBe("tracking");
    expect(p.position.x).toBeCloseTo(2, 10);
  });
});

describe("PoseFusion jitter guard (spec §6 rule 4)", () => {
  it("drops a single reproj-error spike but keeps the prior pose", () => {
    const f = new PoseFusion();
    const good = new Vector3(0, 1, 0);
    // Build a stable history of low error.
    for (let i = 0; i < 5; i++) {
      f.pushQrPose(sample(good, ID, 1), i * 10);
    }
    // A lone spike (>2× median of 1) must be dropped.
    const bad = new Vector3(9, 9, 9);
    const accepted = f.pushQrPose(sample(bad, ID, 5), 100);
    expect(accepted).toBe(false);
    // Pose unchanged — still the good position.
    expect(f.getPose(100).position.x).toBeCloseTo(0, 10);
  });

  it("accepts the spike on the 3rd consecutive outlier (scene changed)", () => {
    const f = new PoseFusion();
    const good = new Vector3(0, 1, 0);
    for (let i = 0; i < 5; i++) f.pushQrPose(sample(good, ID, 1), i * 10);

    const moved = new Vector3(3, 1, 0);
    expect(f.pushQrPose(sample(moved, ID, 5), 100)).toBe(false); // 1st outlier
    expect(f.pushQrPose(sample(moved, ID, 5), 110)).toBe(false); // 2nd outlier
    expect(f.pushQrPose(sample(moved, ID, 5), 120)).toBe(true); // 3rd → accept
    expect(f.getPose(120).position.x).toBeCloseTo(3, 10);
  });

  it("always trusts the first solve (empty history)", () => {
    const f = new PoseFusion();
    expect(f.pushQrPose(sample(new Vector3(0, 1, 0), ID, 7), 0)).toBe(true);
  });
});

function quatDot(a: Quaternion, b: Quaternion): number {
  return Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
}
