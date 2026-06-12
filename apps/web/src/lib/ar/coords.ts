/**
 * Coordinate-frame contract for Mode A pose recovery — the single place
 * the easy-to-get-wrong conversions live (spec §5). Read it three times
 * before touching: every frame-of-reference bug here surfaces as cm-level
 * pose drift in the field, which is exactly what REVIEW.md flags 🔴.
 *
 * Three frames are in play:
 *
 *   1. solve frame   — the frame OpenCV's `SOLVEPNP_IPPE_SQUARE` is defined
 *      in. The marker is the canonical planar square at Z=0 with object
 *      points ordered TL,TR,BR,BL as (-s, s, 0),(s, s, 0),(s,-s,0),(-s,-s,0)
 *      (this exact order and Z=0 plane is a hard precondition of
 *      IPPE_SQUARE — see @techstark/opencv-js calib3d docs). solvePnP
 *      returns rvec/tvec that map a point in this frame INTO the camera
 *      frame (object→camera). OpenCV's camera frame is +X right, +Y down,
 *      +Z forward (into the scene).
 *
 *   2. anchor frame  — the world the rest of Mode A renders in (spec §5):
 *      QR centre is the origin, the QR/ground plane is the XZ plane, +Y is
 *      up (gravity-opposed), +X is the QR's "right". Right-handed. This is
 *      a three.js-native frame (+Y up, +Z toward the viewer).
 *
 *   3. three camera  — three.js camera convention: +X right, +Y up, +Z
 *      BACKWARD (out of the screen toward the viewer), i.e. the camera
 *      looks down its own −Z.
 *
 * The job of this module: take OpenCV's object→camera (rvec,tvec) and emit
 * the camera's position + orientation expressed in the anchor frame, ready
 * to write straight onto a three.js camera.
 */

import { Matrix4, Quaternion, Vector3 } from "three";

export type Point2 = { x: number; y: number };

// TODO(field-test): replace with calibrated intrinsics. fx=fy=w*0.9 is an
// empirical fit for the iPhone wide lens at 1280×720; principal point is the
// frame centre and distortion is assumed zero. Good enough to ship the QR+IMU
// path and measure drift; not good enough to claim final cm-level accuracy.
export function approxIntrinsics(videoW: number, videoH: number): {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
} {
  const f = videoW * 0.9;
  return { fx: f, fy: f, cx: videoW / 2, cy: videoH / 2 };
}

/**
 * Vertical FOV (radians) implied by the approximated intrinsics, for the
 * R3F camera so its projection matches the video. fov = 2·atan(h/(2·fy)).
 */
export function fovYFromIntrinsics(videoH: number, fy: number): number {
  return 2 * Math.atan(videoH / (2 * fy));
}

/**
 * Object-point order for `SOLVEPNP_IPPE_SQUARE`, in the OpenCV solve frame
 * (canonical planar square, Z=0). Units: metres (OpenCV + three.js share
 * metres here). `sizeMm` is the QR's physical edge.
 *
 * Order MUST match the zxing corner order we feed as image points:
 *   TL, TR, BR, BL.
 */
export function squareObjectPoints(sizeMm: number): Vector3[] {
  const s = sizeMm / 1000 / 2;
  return [
    new Vector3(-s, s, 0), // top-left
    new Vector3(s, s, 0), // top-right
    new Vector3(s, -s, 0), // bottom-right
    new Vector3(-s, -s, 0), // bottom-left
  ];
}

/**
 * Anchor-frame object points (spec §5): QR on the ground, XZ plane, +Y up.
 *   TL = (-s, 0, -s), TR = (s, 0, -s), BR = (s, 0, s), BL = (-s, 0, s)
 * Not fed to IPPE_SQUARE (which needs the Z=0 solve frame); kept here as the
 * documented anchor-frame geometry and used by the round-trip test to
 * synthesise a known pose.
 */
export function anchorObjectPoints(sizeMm: number): Vector3[] {
  const s = sizeMm / 1000 / 2;
  return [
    new Vector3(-s, 0, -s), // top-left
    new Vector3(s, 0, -s), // top-right
    new Vector3(s, 0, s), // bottom-right
    new Vector3(-s, 0, s), // bottom-left
  ];
}

/**
 * Rotation that carries a point from the OpenCV solve frame (marker XY,
 * Z=0) to the anchor frame (ground XZ, +Y up). Mapping the canonical
 * square corners onto the anchor corners:
 *   solve (x, y, 0)  →  anchor (x, 0, -y)
 * i.e. X→X, Y→−Z, Z→Y. As a matrix R_as (columns are images of the solve
 * basis vectors):
 *   X_a = ( 1, 0,  0)
 *   Y_a = ( 0, 0, -1)
 *   Z_a = ( 0, 1,  0)
 * This is a proper rotation (det = +1).
 */
const SOLVE_TO_ANCHOR = new Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1,
);

/**
 * Axis flip from the OpenCV camera frame (+Y down, +Z forward) to the
 * three.js camera frame (+Y up, +Z backward): diag(1, -1, -1). Self-inverse.
 */
const CV_TO_GL_CAMERA = new Matrix4().set(
  1, 0, 0, 0,
  0, -1, 0, 0,
  0, 0, -1, 0,
  0, 0, 0, 1,
);

export type CameraPose = { position: Vector3; quaternion: Quaternion };

/**
 * Convert OpenCV's object→camera (rotation matrix `rcm` 3×3 row-major,
 * translation `tcm`) into the camera's pose in the anchor frame.
 *
 * Derivation (spec §5):
 *   solvePnP gives  X_c = R·X_solve + t   (object→camera, OpenCV cam frame).
 *   Camera-in-solve-frame:  R_sc = Rᵀ,  t_sc = −Rᵀ·t.
 *   Re-express the camera frame as three.js (axis flip diag(1,-1,-1) applied
 *   on the camera-frame side):  R_gl = R_sc · diag(1,-1,-1).
 *   Re-express the world side in the anchor frame:
 *     position_anchor = R_as · t_sc
 *     R_anchor        = R_as · R_gl
 * `rcm` is row-major (OpenCV Mat.data layout); we load it into a Matrix4.
 */
export function cvPoseToAnchor(rcm: number[], tcm: number[]): CameraPose {
  // R (object→camera), row-major into a Matrix4 (Matrix4.set is row-major).
  const R = new Matrix4().set(
    rcm[0], rcm[1], rcm[2], 0,
    rcm[3], rcm[4], rcm[5], 0,
    rcm[6], rcm[7], rcm[8], 0,
    0, 0, 0, 1,
  );

  // R_sc = Rᵀ (camera→solve rotation = camera orientation in solve frame).
  const Rsc = R.clone().transpose();

  // t_sc = −Rᵀ·t (camera position in solve frame).
  const t = new Vector3(tcm[0], tcm[1], tcm[2]);
  const tsc = t.clone().applyMatrix4(Rsc).multiplyScalar(-1);

  // three.js camera orientation in solve frame, then rotate world→anchor.
  const Rgl = Rsc.clone().multiply(CV_TO_GL_CAMERA);
  const Ranchor = SOLVE_TO_ANCHOR.clone().multiply(Rgl);

  const position = tsc.applyMatrix4(SOLVE_TO_ANCHOR);
  const quaternion = new Quaternion().setFromRotationMatrix(Ranchor);

  return { position, quaternion };
}

/**
 * zxing's QR `getResultPoints()` returns the centres of the three finder
 * patterns (+ optionally an alignment pattern) — NOT the four outer
 * corners solvePnP needs. The finder-pattern centres sit 3.5 modules in
 * from each outer edge; we extrapolate the outer corners from that
 * geometry (spec §6 qr-detector). This math is the highest-leverage thing
 * to get right and is locked by coords.test.ts.
 *
 * Finder layout (QR self-orientation):
 *   - top-left, top-right, bottom-left finders are present.
 *   - bottom-right has NO finder (only an alignment pattern in v2+).
 * zxing's QRCodeReader emits result points as [bottomLeft, topLeft, topRight]
 * (in that documented order). Each finder centre is offset (3.5, 3.5)
 * modules from its corner of the symbol along the symbol's own axes.
 *
 * Given the three finder centres and the module pitch we reconstruct the
 * symbol's u (left→right) and v (top→bottom) axes in pixels, then step out
 * 3.5 modules past each finder centre to reach the four outer corners.
 *
 * @param finders [bottomLeft, topLeft, topRight] finder-pattern centres (px)
 * @param dimension QR symbol size in modules (e.g. 21 for version 1)
 * @returns outer corners ordered TL, TR, BR, BL (px) — matches objectPoints
 */
export function extrapolateOuterCorners(
  finders: { bottomLeft: Point2; topLeft: Point2; topRight: Point2 },
  dimension: number,
): [Point2, Point2, Point2, Point2] {
  const { bottomLeft, topLeft, topRight } = finders;

  // Symbol axes in pixels, measured finder-centre→finder-centre. The two
  // measured centres span (dimension - 7) modules: each finder centre is
  // 3.5 modules in from its respective edge, so the centre-to-centre span
  // is dimension - 2·3.5 = dimension - 7 modules.
  const span = dimension - 7;

  // u axis: topLeft → topRight (left to right), per module.
  const uPerModule = {
    x: (topRight.x - topLeft.x) / span,
    y: (topRight.y - topLeft.y) / span,
  };
  // v axis: topLeft → bottomLeft (top to bottom), per module.
  const vPerModule = {
    x: (bottomLeft.x - topLeft.x) / span,
    y: (bottomLeft.y - topLeft.y) / span,
  };

  const step = (
    base: Point2,
    du: number,
    dv: number,
  ): Point2 => ({
    x: base.x + du * uPerModule.x + dv * vPerModule.x,
    y: base.y + du * uPerModule.y + dv * vPerModule.y,
  });

  // From each finder centre, step 3.5 modules outward along ±u/±v to the
  // outer corner of the symbol.
  const tl = step(topLeft, -3.5, -3.5);
  const tr = step(topRight, 3.5, -3.5);
  const bl = step(bottomLeft, -3.5, 3.5);
  // Bottom-right has no finder: extrapolate from topRight (down) and
  // bottomLeft (right), which is topRight + v-span + 3.5 down, equivalently
  // bottomLeft + u-span + 3.5 right. Use topRight as the base.
  const br = step(topRight, 3.5, span + 3.5);

  return [tl, tr, br, bl];
}

/**
 * QR version → module dimension. dimension = 17 + 4·version. zxing exposes
 * the version via the symbol's BitMatrix dimension when available; this
 * helper is the fallback when only the version number is known.
 */
export function dimensionForVersion(version: number): number {
  return 17 + 4 * version;
}
