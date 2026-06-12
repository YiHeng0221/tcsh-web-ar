/**
 * Core pose math: QR corner pixels + physical size → 6DoF camera pose in
 * the anchor frame (spec §6 solve-pnp).
 *
 * Pure and stateless (no module-level cv handle) so it's trivially
 * testable: the OpenCV namespace is injected. A3/A4 pass the singleton from
 * `loadOpenCv()`; tests pass the real WASM cv loaded in Node.
 *
 * Every `cv.Mat` allocated here is `.delete()`d before returning — on the
 * success path, the error path, AND the early-return path. The WASM heap is
 * not GC-managed; a single leaked Mat is a real leak (REVIEW.md red line).
 */

import { Quaternion, Vector3 } from "three";

import { approxIntrinsics, cvPoseToAnchor, type Point2 } from "./coords";
import type { Cv } from "./opencv-loader";
import { squareObjectPoints } from "./coords";

export type PnpResult = {
  position: Vector3;
  quaternion: Quaternion;
  reprojErrorPx: number;
};

/** Reprojection error above this (px) means the solve is untrustworthy and
 *  we refuse to snap it into the fusion state (spec §6 quality gate). */
export const REPROJ_ERROR_THRESHOLD_PX = 8;

/**
 * Solve the camera pose from the four QR outer corners.
 *
 * @param cv         the initialised OpenCV namespace (injected)
 * @param cornersPx  outer corners ordered TL, TR, BR, BL (px) — must match
 *                   the object-point order in `squareObjectPoints`
 * @param sizeMm     QR physical edge length (mm) — `AnchorOut.size_mm`
 * @param videoW     video frame width (px), for intrinsics
 * @param videoH     video frame height (px), for intrinsics
 * @returns pose in the anchor frame, or null if the solve failed or its
 *          reprojection error exceeded the quality gate.
 */
export function solveQrPose(
  cv: Cv,
  cornersPx: Point2[],
  sizeMm: number,
  videoW: number,
  videoH: number,
): PnpResult | null {
  if (cornersPx.length !== 4) return null;

  const { fx, fy, cx, cy } = approxIntrinsics(videoW, videoH);
  const objPoints = squareObjectPoints(sizeMm);

  // Allocate every Mat up front so the single `finally` can free them all.
  let objectPoints: InstanceType<Cv["Mat"]> | null = null;
  let imagePoints: InstanceType<Cv["Mat"]> | null = null;
  let cameraMatrix: InstanceType<Cv["Mat"]> | null = null;
  let distCoeffs: InstanceType<Cv["Mat"]> | null = null;
  let rvec: InstanceType<Cv["Mat"]> | null = null;
  let tvec: InstanceType<Cv["Mat"]> | null = null;
  let rotMat: InstanceType<Cv["Mat"]> | null = null;
  let projected: InstanceType<Cv["Mat"]> | null = null;

  try {
    objectPoints = cv.matFromArray(
      4,
      3,
      cv.CV_64F,
      objPoints.flatMap((p) => [p.x, p.y, p.z]),
    );
    imagePoints = cv.matFromArray(
      4,
      2,
      cv.CV_64F,
      cornersPx.flatMap((p) => [p.x, p.y]),
    );
    cameraMatrix = cv.matFromArray(3, 3, cv.CV_64F, [
      fx, 0, cx,
      0, fy, cy,
      0, 0, 1,
    ]);
    // Zero distortion (spec §5 approximation).
    distCoeffs = cv.matFromArray(1, 5, cv.CV_64F, [0, 0, 0, 0, 0]);

    rvec = new cv.Mat();
    tvec = new cv.Mat();

    const ok = cv.solvePnP(
      objectPoints,
      imagePoints,
      cameraMatrix,
      distCoeffs,
      rvec,
      tvec,
      false,
      cv.SOLVEPNP_IPPE_SQUARE,
    );
    if (!ok) return null;

    // Reprojection error: project the object points with the solved pose and
    // compare to the measured image points (RMS over the 4 corners).
    projected = new cv.Mat();
    cv.projectPoints(
      objectPoints,
      rvec,
      tvec,
      cameraMatrix,
      distCoeffs,
      projected,
    );
    // projectPoints yields an Nx1 2-channel (CV_64FC2) Mat; read the flat
    // [x0,y0,x1,y1,...] buffer rather than channel-indexing with doubleAt.
    const projData = projected.data64F;
    let sumSq = 0;
    for (let i = 0; i < 4; i++) {
      const dx = projData[i * 2] - cornersPx[i].x;
      const dy = projData[i * 2 + 1] - cornersPx[i].y;
      sumSq += dx * dx + dy * dy;
    }
    const reprojErrorPx = Math.sqrt(sumSq / 4);
    if (reprojErrorPx > REPROJ_ERROR_THRESHOLD_PX) return null;

    // rvec (Rodrigues) → 3×3 rotation matrix, read out row-major.
    rotMat = new cv.Mat();
    cv.Rodrigues(rvec, rotMat);
    const rcm = Array.from(rotMat.data64F.slice(0, 9));
    const tcm = Array.from(tvec.data64F.slice(0, 3));

    const { position, quaternion } = cvPoseToAnchor(rcm, tcm);
    return { position, quaternion, reprojErrorPx };
  } finally {
    objectPoints?.delete();
    imagePoints?.delete();
    cameraMatrix?.delete();
    distCoeffs?.delete();
    rvec?.delete();
    tvec?.delete();
    rotMat?.delete();
    projected?.delete();
  }
}
