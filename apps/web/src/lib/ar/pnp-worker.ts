/**
 * solvePnP Web Worker — pose solving runs HERE, off the main thread.
 *
 * History: this worker existed because importing the ~11 MB
 * @techstark/opencv-js module froze the iPhone Safari main thread for the
 * whole parse/eval/WASM-compile (HUD stuck at cv=loading(0s), tap handlers
 * dead). That compile cost is gone: the solver is now PURE TYPESCRIPT
 * (`ippe.ts` — a hand-written IPPE square pose solver that reproduces
 * OpenCV's `SOLVEPNP_IPPE_SQUARE`), so there's nothing heavy to download or
 * compile any more.
 *
 * The worker is kept (this PR deliberately does NOT touch the worker
 * architecture — that teardown is a follow-up) so the client + ARView are
 * untouched. The `ready` handshake still fires; it just fires immediately
 * because the solver has no async warm-up. Solves remain a postMessage
 * round-trip, keeping even the (now trivial) compute off the render thread.
 *
 * Protocol (worker ⇄ client) — unchanged, the client is none the wiser:
 *   client → worker: { type: "solve", id, corners, sizeMm, videoW, videoH }
 *   worker → client: { type: "ready" }                       — solver ready
 *                    { type: "ready-error", message }        — (now unused)
 *                    { type: "result", id, pose | null }     — solve answer
 *
 * Poses are plain JSON (positions/quaternions as number arrays) — three.js
 * objects don't survive structured clone, so the client re-hydrates.
 */

import { solveSquarePose } from "./ippe";
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

// The pure-TS solver is ready the instant the module evaluates — no WASM to
// download or compile. Announce readiness on the next tick so the client's
// onmessage handler is wired up before it fires (the constructor sets it
// synchronously, but a microtask is the safe, allocation-free guarantee).
queueMicrotask(() => postMessage({ type: "ready" }));

onmessage = (event: MessageEvent<SolveRequest>) => {
  const msg = event.data;
  if (msg.type !== "solve") return;

  const pose = solveSquarePose(msg.corners, msg.sizeMm, msg.videoW, msg.videoH);
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
