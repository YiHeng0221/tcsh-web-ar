/**
 * solvePnP Web Worker — OpenCV lives HERE, never on the main thread.
 *
 * Field finding (2026-06-13, iPhone Safari): importing the ~11 MB
 * @techstark/opencv-js module on the main thread freezes the entire JS
 * event loop for the whole parse/eval/WASM-compile — the camera feed
 * kept compositing but every interval, frame callback, and tap handler
 * was dead (HUD stuck at cv=loading(0s), attempts=0, mode switch
 * unresponsive). Workers parse + compile on their own thread, so the
 * UI/scan loop stays alive while OpenCV warms up.
 *
 * Protocol (worker ⇄ client):
 *   client → worker: { type: "solve", id, corners, sizeMm, videoW, videoH }
 *   worker → client: { type: "ready" }                       — cv compiled
 *                    { type: "ready-error", message }        — load failed
 *                    { type: "result", id, pose | null }     — solve answer
 *
 * Poses are plain JSON (positions/quaternions as number arrays) — three.js
 * objects don't survive structured clone, so the client re-hydrates.
 */

import { loadOpenCv, type Cv } from "./opencv-loader";
import { solveQrPose } from "./solve-pnp";
import type { Point2 } from "./coords";

type SolveRequest = {
  type: "solve";
  id: number;
  corners: [Point2, Point2, Point2, Point2];
  sizeMm: number;
  videoW: number;
  videoH: number;
};

export type WirePose = {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  reprojErrorPx: number;
};

let cv: Cv | null = null;

const cvReady = loadOpenCv()
  .then((loaded) => {
    cv = loaded;
    postMessage({ type: "ready" });
  })
  .catch((err: unknown) => {
    postMessage({
      type: "ready-error",
      message: err instanceof Error ? err.message : String(err),
    });
  });

onmessage = async (event: MessageEvent<SolveRequest>) => {
  const msg = event.data;
  if (msg.type !== "solve") return;
  // Queue solves behind the cv load rather than erroring — a request that
  // raced the compile simply waits.
  await cvReady;
  if (!cv) {
    postMessage({ type: "result", id: msg.id, pose: null });
    return;
  }
  const pose = solveQrPose(cv, msg.corners, msg.sizeMm, msg.videoW, msg.videoH);
  const wire: WirePose | null = pose
    ? {
        position: [pose.position.x, pose.position.y, pose.position.z],
        quaternion: [
          pose.quaternion.x,
          pose.quaternion.y,
          pose.quaternion.z,
          pose.quaternion.w,
        ],
        reprojErrorPx: pose.reprojErrorPx,
      }
    : null;
  postMessage({ type: "result", id: msg.id, pose: wire });
};
