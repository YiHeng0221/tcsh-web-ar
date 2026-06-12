/**
 * QR detection wrapper around `@zxing/browser` (spec §6 qr-detector).
 *
 * Why a manual frame loop instead of zxing's `decodeFromVideoElement`
 * continuous mode: that mode decodes as fast as it can with no frequency
 * control, which burns battery and CPU. We drive a single-shot `decode()`
 * ourselves on `requestVideoFrameCallback` (falling back to rAF), throttled
 * to ~10fps (A3 scan) — the caller can run it slower (2fps) for A4's
 * background recalibration loop.
 *
 * Corner extraction: zxing's `getResultPoints()` for a QR returns the three
 * finder-pattern centres, NOT the four outer corners solvePnP wants. We
 * extrapolate the outer corners from the finder geometry — that math lives
 * in `coords.ts` (and is unit-tested there); this module only adapts zxing's
 * point ordering into it.
 */

import { BrowserQRCodeReader } from "@zxing/browser";
import type { Result } from "@zxing/library";

import {
  dimensionForVersion,
  extrapolateOuterCorners,
  type Point2,
} from "./coords";

/** Default throttle between decode attempts (ms) — ~10fps. */
export const DEFAULT_THROTTLE_MS = 100;

/**
 * Conservative default QR module dimension. zxing's public `Result` does
 * not expose the decoded symbol's version/dimension, so we assume version 3
 * (29 modules) — the smallest version that comfortably holds a
 * `tcsh://station/{uuid}` payload. The solvePnP reprojection-error gate
 * rejects poses where this assumption is wrong enough to matter, and the
 * value is overridable per call site.
 * TODO(field-test): if reproj error is systematically high, recover the
 * real dimension (jsQR returns true corners — see spec §9).
 */
export const DEFAULT_QR_DIMENSION = dimensionForVersion(3);

export type StationPayload =
  | { kind: "station"; stationId: string }
  | { kind: "foreign" };

/** Parse the QR text. Our codes are `tcsh://station/{station_id}`; anything
 *  else is someone else's QR. */
export function parseStationPayload(text: string): StationPayload {
  const match = /^tcsh:\/\/station\/(.+)$/.exec(text.trim());
  if (!match) return { kind: "foreign" };
  const stationId = match[1].trim();
  if (stationId.length === 0) return { kind: "foreign" };
  return { kind: "station", stationId };
}

/**
 * Pull the four outer corners (TL,TR,BR,BL, px) out of a zxing QR result.
 *
 * zxing's QRCodeReader emits result points in the order
 * [bottomLeft, topLeft, topRight] (the three finder-pattern centres; a 4th
 * alignment point may follow on version ≥ 2 but we don't rely on it). We
 * map those into the finder-geometry extrapolation in coords.ts.
 *
 * Returns null if the result doesn't carry the expected ≥3 finder points.
 */
export function cornersFromResult(
  result: Result,
  dimension: number = DEFAULT_QR_DIMENSION,
): [Point2, Point2, Point2, Point2] | null {
  const points = result.getResultPoints();
  if (!points || points.length < 3) return null;
  const [bottomLeft, topLeft, topRight] = points;
  return extrapolateOuterCorners(
    {
      bottomLeft: { x: bottomLeft.getX(), y: bottomLeft.getY() },
      topLeft: { x: topLeft.getX(), y: topLeft.getY() },
      topRight: { x: topRight.getX(), y: topRight.getY() },
    },
    dimension,
  );
}

export type QrDetection = {
  payload: StationPayload;
  corners: [Point2, Point2, Point2, Point2] | null;
  text: string;
};

export type QrDetectorOptions = {
  throttleMs?: number;
  qrDimension?: number;
  /** Called on every successful decode (throttled). */
  onDetection: (detection: QrDetection) => void;
};

/**
 * Drives a throttled single-shot decode loop over a <video>. Call `start`
 * once the video is playing; call `dispose()` on unmount — it resets the
 * zxing reader and cancels the frame loop (REVIEW.md red line: a dangling
 * BrowserQRCodeReader leaks on iOS Safari).
 */
export class QrDetector {
  private readonly reader = new BrowserQRCodeReader();
  private readonly throttleMs: number;
  private readonly qrDimension: number;
  private readonly onDetection: (d: QrDetection) => void;

  private video: HTMLVideoElement | null = null;
  private running = false;
  private lastAttempt = 0;
  private rafId: number | null = null;
  private vfcId: number | null = null;

  constructor(opts: QrDetectorOptions) {
    this.throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
    this.qrDimension = opts.qrDimension ?? DEFAULT_QR_DIMENSION;
    this.onDetection = opts.onDetection;
  }

  start(video: HTMLVideoElement): void {
    if (this.running) return;
    this.video = video;
    this.running = true;
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (!this.running || !this.video) return;
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    if (typeof v.requestVideoFrameCallback === "function") {
      this.vfcId = v.requestVideoFrameCallback(() => this.tick());
    } else {
      this.rafId = requestAnimationFrame(() => this.tick());
    }
  }

  private tick(): void {
    if (!this.running || !this.video) return;
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - this.lastAttempt >= this.throttleMs) {
      this.lastAttempt = now;
      this.attemptDecode();
    }
    this.scheduleNext();
  }

  private attemptDecode(): void {
    if (!this.video) return;
    let result: Result | null = null;
    try {
      result = this.reader.decode(this.video);
    } catch {
      // NotFoundException etc. — no QR this frame, normal. Keep scanning.
      return;
    }
    if (!result) return;
    const text = result.getText();
    const payload = parseStationPayload(text);
    const corners =
      payload.kind === "station"
        ? cornersFromResult(result, this.qrDimension)
        : null;
    this.onDetection({ payload, corners, text });
  }

  dispose(): void {
    this.running = false;
    const v = this.video as
      | (HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void })
      | null;
    if (this.vfcId != null && v?.cancelVideoFrameCallback) {
      v.cancelVideoFrameCallback(this.vfcId);
    }
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.vfcId = null;
    this.rafId = null;
    // BrowserCodeReader exposes a static reset to tear down scanner state.
    try {
      (
        this.reader as unknown as { reset?: () => void }
      ).reset?.();
    } catch {
      // best-effort cleanup
    }
    this.video = null;
  }
}
