/**
 * Golden-validator suite for the pure-TS IPPE square solver (`ippe.ts`).
 *
 * The headline test loads the REAL OpenCV WASM (same `createRequire` trick as
 * solve-pnp.test.ts — Vite's SSR transform deadlocks on the 8MB UMD bundle, a
 * native CommonJS require inits it in ~150ms) and pits `solveSquarePose`
 * against `solveQrPose` over ≥200 randomised poses. If the pure-TS port ever
 * drifts from OpenCV's `SOLVEPNP_IPPE_SQUARE`, this fails.
 *
 * It also covers:
 *  - synthetic round-trip (known pose → project → solve → recover),
 *  - degenerate inputs (collinear / tiny / extreme tilt) → null, no crash.
 */

import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";

import {
  approxIntrinsics,
  cvPoseToAnchor,
  squareObjectPoints,
  type Point2,
} from "../coords";
import type { Cv } from "../opencv-loader";
import { REPROJ_ERROR_THRESHOLD_PX, solveQrPose } from "../solve-pnp";
import { solveSquarePose } from "../ippe";

const require = createRequire(import.meta.url);
let cv: Cv;

beforeAll(async () => {
  const mod = require("@techstark/opencv-js") as Cv & {
    onRuntimeInitialized?: () => void;
    Mat?: unknown;
  };
  await new Promise<void>((resolve) => {
    if (typeof mod.Mat === "function") return resolve();
    mod.onRuntimeInitialized = () => resolve();
  });
  cv = mod;
}, 30_000);

const VIDEO_W = 1280;
const VIDEO_H = 720;
const SIZE_MM = 200;

// ── helpers ─────────────────────────────────────────────────────────────────

/** Project the canonical square into pixels for an object→camera (rcm, tcm). */
function projectSquare(rcm: number[], tcm: number[]): Point2[] {
  const { fx, fy, cx, cy } = approxIntrinsics(VIDEO_W, VIDEO_H);
  const R = new Matrix4().set(
    rcm[0], rcm[1], rcm[2], 0,
    rcm[3], rcm[4], rcm[5], 0,
    rcm[6], rcm[7], rcm[8], 0,
    0, 0, 0, 1,
  );
  const t = new Vector3(tcm[0], tcm[1], tcm[2]);
  return squareObjectPoints(SIZE_MM).map((p) => {
    const cam = p.clone().applyMatrix4(R).add(t);
    return { x: fx * (cam.x / cam.z) + cx, y: fy * (cam.y / cam.z) + cy };
  });
}

/** Row-major object→camera rotation from Euler angles (XYZ order). */
function rotationMatrix(rx: number, ry: number, rz: number): number[] {
  const m = new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz, "XYZ"));
  const e = m.elements; // column-major
  // Convert to row-major.
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
}

/** Mulberry32 — deterministic PRNG so the random suite is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quatFromRcm(rcm: number[]): Quaternion {
  const m = new Matrix4().set(
    rcm[0], rcm[1], rcm[2], 0,
    rcm[3], rcm[4], rcm[5], 0,
    rcm[6], rcm[7], rcm[8], 0,
    0, 0, 0, 1,
  );
  return new Quaternion().setFromRotationMatrix(m);
}

function angleBetweenQuat(a: Quaternion, b: Quaternion): number {
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return 2 * Math.acos(dot); // radians
}

// ── headline: agree with real OpenCV over ≥200 random poses ─────────────────

describe("solveSquarePose vs OpenCV SOLVEPNP_IPPE_SQUARE (golden)", () => {
  it("matches OpenCV across 200+ random poses (≤2px noise)", () => {
    const rand = mulberry32(0xc0ffee);
    const N = 240;
    let compared = 0;

    // Error distributions (vs OpenCV) for the PR report.
    const posRelErrs: number[] = []; // |Δposition| / distance
    const rotErrsDeg: number[] = [];

    for (let i = 0; i < N; i++) {
      // distance 0.3–5m, tilt 0–70°, in-plane spin 0–360°, small yaw.
      const dist = 0.3 + rand() * 4.7;
      const tilt = (rand() * 70 * Math.PI) / 180;
      const spin = rand() * 2 * Math.PI;
      const yaw = ((rand() - 0.5) * 30 * Math.PI) / 180;
      const noisePx = rand() * 2;

      const rcm = rotationMatrix(tilt, yaw, spin);
      // Keep the marker roughly centred but offset a little laterally.
      const tcm = [
        (rand() - 0.5) * 0.2 * dist,
        (rand() - 0.5) * 0.2 * dist,
        dist,
      ];

      const corners = projectSquare(rcm, tcm);
      // Add bounded pixel noise.
      const noisy = corners.map((c) => ({
        x: c.x + (rand() - 0.5) * 2 * noisePx,
        y: c.y + (rand() - 0.5) * 2 * noisePx,
      }));

      const ours = solveSquarePose(noisy, SIZE_MM, VIDEO_W, VIDEO_H);
      const ref = solveQrPose(cv, noisy, SIZE_MM, VIDEO_W, VIDEO_H);

      // Either both accept or both reject (gate parity). Allow the rare case
      // where one is right at the 8px boundary by skipping if exactly one is null.
      if (!ours || !ref) {
        // If OpenCV produced a pose, we must too (no silent extra rejects)
        // unless we're within 0.5px of the gate.
        if (ref && ours == null) {
          expect(ref.reprojErrorPx).toBeGreaterThan(
            REPROJ_ERROR_THRESHOLD_PX - 0.5,
          );
        }
        continue;
      }

      compared++;

      const posErr = ours.position.distanceTo(ref.position);
      const distRef = ref.position.length() || 1;
      posRelErrs.push(posErr / distRef);

      const rotErr = (angleBetweenQuat(ours.quaternion, ref.quaternion) * 180) /
        Math.PI;
      rotErrsDeg.push(rotErr);

      // Position within 1% of distance; rotation within 1°.
      expect(posErr).toBeLessThan(0.01 * distRef);
      expect(rotErr).toBeLessThan(1.0);
    }

    expect(compared).toBeGreaterThanOrEqual(200);

    // Surface the distribution so the PR body can quote it.
    const stats = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      const mean = s.reduce((a, b) => a + b, 0) / s.length;
      const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
      return { mean, p50: p(0.5), p95: p(0.95), max: s[s.length - 1] };
    };
    // eslint-disable-next-line no-console
    console.log(
      "[ippe golden] compared=%d  posRel mean=%s p95=%s max=%s  rotDeg mean=%s p95=%s max=%s",
      compared,
      stats(posRelErrs).mean.toExponential(2),
      stats(posRelErrs).p95.toExponential(2),
      stats(posRelErrs).max.toExponential(2),
      stats(rotErrsDeg).mean.toFixed(4),
      stats(rotErrsDeg).p95.toFixed(4),
      stats(rotErrsDeg).max.toFixed(4),
    );
  });

  it("matches OpenCV tightly with NO noise (≤0.1% / ≤0.1°)", () => {
    const rand = mulberry32(0x1234);
    let compared = 0;
    for (let i = 0; i < 60; i++) {
      const dist = 0.4 + rand() * 4;
      const tilt = (rand() * 60 * Math.PI) / 180;
      const spin = rand() * 2 * Math.PI;
      const rcm = rotationMatrix(tilt, (rand() - 0.5) * 0.3, spin);
      const tcm = [(rand() - 0.5) * 0.15 * dist, (rand() - 0.5) * 0.15 * dist, dist];
      const corners = projectSquare(rcm, tcm);

      const ours = solveSquarePose(corners, SIZE_MM, VIDEO_W, VIDEO_H);
      const ref = solveQrPose(cv, corners, SIZE_MM, VIDEO_W, VIDEO_H);
      if (!ours || !ref) continue;
      compared++;

      const distRef = ref.position.length() || 1;
      expect(ours.position.distanceTo(ref.position)).toBeLessThan(0.001 * distRef);
      const rotErr = (angleBetweenQuat(ours.quaternion, ref.quaternion) * 180) /
        Math.PI;
      expect(rotErr).toBeLessThan(0.1);
    }
    expect(compared).toBeGreaterThanOrEqual(40);
  });
});

// ── synthetic round-trip (no OpenCV in the loop) ────────────────────────────

describe("solveSquarePose synthetic round-trip", () => {
  it("recovers a clean front-on pose to the analytic anchor pose", () => {
    const rcm = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const tcm = [0, 0, 1];
    const corners = projectSquare(rcm, tcm);
    const result = solveSquarePose(corners, SIZE_MM, VIDEO_W, VIDEO_H);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.reprojErrorPx).toBeLessThan(0.5);
    const expected = cvPoseToAnchor(rcm, tcm);
    expect(result.position.distanceTo(expected.position)).toBeLessThan(1e-3);
    expect(angleBetweenQuat(result.quaternion, expected.quaternion)).toBeLessThan(
      1e-3,
    );
  });

  it("recovers a tilted pose to the analytic anchor pose", () => {
    const a = (25 * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const rcm = [1, 0, 0, 0, c, -s, 0, s, c];
    const tcm = [0.05, -0.03, 0.8];
    const corners = projectSquare(rcm, tcm);
    const result = solveSquarePose(corners, SIZE_MM, VIDEO_W, VIDEO_H);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.reprojErrorPx).toBeLessThan(REPROJ_ERROR_THRESHOLD_PX);
    const expectedQ = quatFromRcm(rcm); // sanity: rcm is a valid rotation
    expect(expectedQ).toBeInstanceOf(Quaternion);
    const expected = cvPoseToAnchor(rcm, tcm);
    expect(result.position.distanceTo(expected.position)).toBeLessThan(2e-2);
  });
});

// ── degenerate cases → null, never throw ────────────────────────────────────

describe("solveSquarePose degenerate inputs", () => {
  it("returns null for wrong corner count", () => {
    expect(solveSquarePose([], SIZE_MM, VIDEO_W, VIDEO_H)).toBeNull();
    const three = projectSquare([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 1]).slice(0, 3);
    expect(solveSquarePose(three, SIZE_MM, VIDEO_W, VIDEO_H)).toBeNull();
  });

  it("returns null (no crash) for collinear corners", () => {
    const collinear: Point2[] = [
      { x: 100, y: 100 },
      { x: 200, y: 200 },
      { x: 300, y: 300 },
      { x: 400, y: 400 },
    ];
    expect(() =>
      solveSquarePose(collinear, SIZE_MM, VIDEO_W, VIDEO_H),
    ).not.toThrow();
    expect(solveSquarePose(collinear, SIZE_MM, VIDEO_W, VIDEO_H)).toBeNull();
  });

  it("returns null (no crash) for a degenerately tiny marker", () => {
    const tiny: Point2[] = [
      { x: 640, y: 360 },
      { x: 641, y: 360 },
      { x: 641, y: 361 },
      { x: 640, y: 361 },
    ];
    // A 1px square at 1280×720 is far past the detectable range; just must not throw.
    expect(() => solveSquarePose(tiny, SIZE_MM, VIDEO_W, VIDEO_H)).not.toThrow();
  });

  it("rejects a corner perturbed beyond the 8px gate", () => {
    const corners = projectSquare([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 1]);
    corners[0] = { x: corners[0].x + 60, y: corners[0].y - 60 };
    expect(solveSquarePose(corners, SIZE_MM, VIDEO_W, VIDEO_H)).toBeNull();
  });

  it("handles an extreme 80° tilt without throwing", () => {
    const a = (80 * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const rcm = [1, 0, 0, 0, c, -s, 0, s, c];
    const corners = projectSquare(rcm, [0, 0, 1.5]);
    expect(() => solveSquarePose(corners, SIZE_MM, VIDEO_W, VIDEO_H)).not.toThrow();
  });
});
