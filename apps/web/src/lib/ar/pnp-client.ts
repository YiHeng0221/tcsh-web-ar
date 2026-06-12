/**
 * Main-thread client for the solvePnP worker (see pnp-worker.ts for WHY
 * OpenCV must not load on the main thread).
 *
 * Lifecycle mirrors the other lib/ar resources: construct once per AR
 * session, `dispose()` on teardown (terminates the worker and frees the
 * WASM heap with it — REVIEW.md red line: no dangling workers).
 */

import { Quaternion, Vector3 } from "three";

import type { Point2 } from "./coords";
import type { PnpResult } from "./solve-pnp";
import type { WirePose } from "./pnp-worker";

export type PnpWorkerState = "loading" | "ready" | "failed";

type ResultMessage =
  | { type: "ready" }
  | { type: "ready-error"; message: string }
  | { type: "result"; id: number; pose: WirePose | null };

export class PnpWorkerClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    (pose: PnpResult | null) => void
  >();

  state: PnpWorkerState = "loading";
  /** Populated when state === "failed". */
  error: string | null = null;
  /** Called on ready / failure — drives the HUD + reticle hint. */
  onStateChange?: (state: PnpWorkerState) => void;

  constructor() {
    // Vite-native worker syntax: bundles pnp-worker.ts (and its opencv
    // dynamic import) into a separate worker chunk in prod; serves it as
    // a module worker in dev.
    this.worker = new Worker(new URL("./pnp-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<ResultMessage>) => {
      const msg = event.data;
      if (msg.type === "ready") {
        this.state = "ready";
        this.onStateChange?.("ready");
        return;
      }
      if (msg.type === "ready-error") {
        this.state = "failed";
        this.error = msg.message;
        this.onStateChange?.("failed");
        // Flush waiters — nothing will ever resolve them otherwise.
        for (const resolve of this.pending.values()) resolve(null);
        this.pending.clear();
        return;
      }
      const resolve = this.pending.get(msg.id);
      if (resolve) {
        this.pending.delete(msg.id);
        resolve(
          msg.pose
            ? {
                position: new Vector3(...msg.pose.position),
                quaternion: new Quaternion(...msg.pose.quaternion),
                reprojErrorPx: msg.pose.reprojErrorPx,
              }
            : null,
        );
      }
    };
  }

  /**
   * Solve asynchronously. Drops (resolves null) if the worker has already
   * failed. Solves issued while opencv is still compiling are queued by
   * the worker and answered when it's ready.
   */
  solve(
    corners: [Point2, Point2, Point2, Point2],
    sizeMm: number,
    videoW: number,
    videoH: number,
  ): Promise<PnpResult | null> {
    if (this.state === "failed") return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise<PnpResult | null>((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({
        type: "solve",
        id,
        corners,
        sizeMm,
        videoW,
        videoH,
      });
    });
  }

  dispose(): void {
    this.worker.terminate();
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
  }
}
