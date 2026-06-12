import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";

import {
  approxIntrinsics,
  cvPoseToAnchor,
  squareObjectPoints,
  type Point2,
} from "../coords";
import type { Cv } from "../opencv-loader";
import { REPROJ_ERROR_THRESHOLD_PX, solveQrPose } from "../solve-pnp";

// solve-pnp.test.ts injects the REAL OpenCV WASM — no mocking, so the
// IPPE_SQUARE solve + 8px reprojection gate are locked against ground truth.
//
// We load OpenCV here via Node's `createRequire` rather than the production
// `loadOpenCv()` dynamic import. Reason: vite's SSR transform of the ~8MB
// eval-bootstrapped UMD bundle deadlocks the vitest worker, whereas a native
// CommonJS require inits the same module in ~150ms. The production loader
// keeps its dynamic `import()` (that's how Vite code-splits it out of the
// main browser bundle); this is a test-runner-only loading concern.
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

/**
 * Project the canonical square object points into pixels for a chosen
 * camera, using the same approximated intrinsics solveQrPose uses. The
 * camera is defined by an object→camera rotation matrix (row-major) and a
 * translation in the OpenCV solve frame — i.e. exactly solvePnP's output
 * convention, so a correct solve must recover (rcm, tcm) up to noise.
 */
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
    const cam = p.clone().applyMatrix4(R).add(t); // object→camera
    return { x: fx * (cam.x / cam.z) + cx, y: fy * (cam.y / cam.z) + cy };
  });
}

/** A camera placed 1m in front of the marker looking straight at it
 *  (object→camera = identity rotation, +1m along camera +Z). */
const FRONT_VIEW = {
  rcm: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  tcm: [0, 0, 1],
};

/** A tilted view: rotate the marker 20° about X then push it 0.8m forward. */
function tiltedView(): { rcm: number[]; tcm: number[] } {
  const a = (20 * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Rotation about X by a (row-major).
  const rcm = [1, 0, 0, 0, c, -s, 0, s, c];
  return { rcm, tcm: [0.05, -0.03, 0.8] };
}

describe("solveQrPose (real OpenCV)", () => {
  it("recovers a clean front-on pose with sub-pixel reproj error", () => {
    const corners = projectSquare(FRONT_VIEW.rcm, FRONT_VIEW.tcm);
    const result = solveQrPose(cv, corners, SIZE_MM, VIDEO_W, VIDEO_H);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.reprojErrorPx).toBeLessThan(REPROJ_ERROR_THRESHOLD_PX);
    expect(result.reprojErrorPx).toBeLessThan(0.5);

    // Compare against the analytic anchor pose for this (rcm, tcm).
    const expected = cvPoseToAnchor(FRONT_VIEW.rcm, FRONT_VIEW.tcm);
    expectPoseClose(result, expected);
  });

  it("recovers a tilted pose", () => {
    const view = tiltedView();
    const corners = projectSquare(view.rcm, view.tcm);
    const result = solveQrPose(cv, corners, SIZE_MM, VIDEO_W, VIDEO_H);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.reprojErrorPx).toBeLessThan(REPROJ_ERROR_THRESHOLD_PX);
    const expected = cvPoseToAnchor(view.rcm, view.tcm);
    expectPoseClose(result, expected, 2);
  });

  it("returns null when corner count is not 4", () => {
    expect(solveQrPose(cv, [], SIZE_MM, VIDEO_W, VIDEO_H)).toBeNull();
    const three = projectSquare(FRONT_VIEW.rcm, FRONT_VIEW.tcm).slice(0, 3);
    expect(solveQrPose(cv, three, SIZE_MM, VIDEO_W, VIDEO_H)).toBeNull();
  });

  it("rejects a solve whose reprojection error exceeds the 8px gate", () => {
    // Perturb one corner by a large amount so no consistent pose fits → the
    // best solve still leaves a big reprojection residual.
    const corners = projectSquare(FRONT_VIEW.rcm, FRONT_VIEW.tcm);
    corners[0] = { x: corners[0].x + 60, y: corners[0].y - 60 };
    const result = solveQrPose(cv, corners, SIZE_MM, VIDEO_W, VIDEO_H);
    expect(result).toBeNull();
  });
});

function expectPoseClose(
  got: { position: Vector3; quaternion: { x: number; y: number; z: number; w: number } },
  expected: { position: Vector3; quaternion: { x: number; y: number; z: number; w: number } },
  digits = 3,
): void {
  expect(got.position.x).toBeCloseTo(expected.position.x, digits);
  expect(got.position.y).toBeCloseTo(expected.position.y, digits);
  expect(got.position.z).toBeCloseTo(expected.position.z, digits);
  const dot = Math.abs(
    got.quaternion.x * expected.quaternion.x +
      got.quaternion.y * expected.quaternion.y +
      got.quaternion.z * expected.quaternion.z +
      got.quaternion.w * expected.quaternion.w,
  );
  expect(dot).toBeCloseTo(1, digits);
}
