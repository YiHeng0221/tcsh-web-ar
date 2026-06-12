/**
 * Fuse the QR-anchor pose with 8th Wall SLAM into one world-locked transform.
 *
 * Two independent pose sources, sampled at the SAME instant:
 *
 *   - `M_qr`   — camera pose in the artwork's **anchor frame** (QR centre =
 *     origin, +Y up). Produced by `solveSquarePose` (`lib/ar/ippe.ts`) as
 *     `{ position, quaternion }`, i.e. the rigid transform camera→anchor.
 *   - `M_slam` — camera pose in the **SLAM world** that XR8 maintains as the
 *     user walks. Read from `processCpuResult.reality` each frame and applied
 *     by the engine to the three.js camera, i.e. the transform camera→slam.
 *
 * We want placements (authored in the anchor frame) expressed in the SLAM world
 * so the engine's persistent tracking keeps them pinned while the user moves.
 * For any rigid frames, with `X_slam = M_slam · X_camera` and
 * `X_anchor = M_qr · X_camera`:
 *
 *     X_slam = M_slam · M_qr⁻¹ · X_anchor
 *     ⇒  T_slam←anchor = M_slam · M_qr⁻¹
 *
 * Captured once at the alignment instant, `T` is then constant: every placement
 * `P_anchor` becomes `P_slam = T · P_anchor`, parented to the XR8 scene. From
 * there SLAM owns the camera and the placements stay put in the real world.
 *
 * Pure three.js math (Matrix4 only); no XR8, no DOM — unit-testable in node.
 */

import { Matrix4, Quaternion, Vector3 } from "three";

export type Pose = {
  position: Vector3;
  quaternion: Quaternion;
};

/** Compose a rigid transform (rotation + translation, unit scale). */
export function poseToMatrix(pose: Pose): Matrix4 {
  return new Matrix4().compose(
    pose.position,
    pose.quaternion,
    new Vector3(1, 1, 1),
  );
}

/**
 * Alignment transform `T_slam←anchor = M_slam · M_qr⁻¹`, sampled at one instant.
 *
 * @param cameraInAnchor camera pose in the anchor frame (from solveSquarePose)
 * @param cameraInSlam   camera pose in the SLAM world (from XR8 reality)
 * @returns the Matrix4 that maps any anchor-frame point into the SLAM world
 */
export function computeAlignment(
  cameraInAnchor: Pose,
  cameraInSlam: Pose,
): Matrix4 {
  const mQr = poseToMatrix(cameraInAnchor);
  const mSlam = poseToMatrix(cameraInSlam);
  const mQrInv = mQr.clone().invert();
  return mSlam.multiply(mQrInv); // M_slam · M_qr⁻¹
}

/**
 * Map an anchor-frame transform (position / quaternion / scale) into the SLAM
 * world through a precomputed alignment `T`. Returns decomposed TRS ready to
 * write onto a three.js Object3D.
 */
export function applyAlignment(
  alignment: Matrix4,
  anchor: { position: Vector3; quaternion: Quaternion; scale: Vector3 },
): { position: Vector3; quaternion: Quaternion; scale: Vector3 } {
  const local = new Matrix4().compose(
    anchor.position,
    anchor.quaternion,
    anchor.scale,
  );
  const world = alignment.clone().multiply(local);

  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  world.decompose(position, quaternion, scale);
  return { position, quaternion, scale };
}
