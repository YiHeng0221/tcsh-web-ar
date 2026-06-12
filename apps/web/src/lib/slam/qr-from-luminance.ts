/**
 * Decode a QR straight from a grayscale luminance buffer.
 *
 * Mode A's `QrDetector` decodes from a `<video>` via `@zxing/browser`. Under
 * 8th Wall there is no `<video>` we control — the engine owns the camera. The
 * engine *does* hand us raw luminance frames through
 * `XR8.CameraPixelArray.pipelineModule({ luminance: true })`, so we decode those
 * with zxing's low-level core (`RGBLuminanceSource` → `HybridBinarizer` →
 * `QRCodeReader`), reusing Mode A's finder-point → outer-corner extrapolation
 * and station-payload parsing verbatim. Same coordinate contract, no camera
 * contention, no canvas readback.
 */

import {
  BinaryBitmap,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from "@zxing/library";

import { cornersFromResult, parseStationPayload } from "@/lib/ar/qr-detector";
import type { Point2 } from "@/lib/ar/coords";
import type { StationPayload } from "@/lib/ar/qr-detector";

export type LuminanceQrDetection = {
  payload: StationPayload;
  corners: [Point2, Point2, Point2, Point2] | null;
  text: string;
};

/**
 * Decode a single QR from a luminance buffer. Returns null when no QR is found
 * (the common per-frame case — keep callers cheap). `rows`/`cols` are the frame
 * dimensions in pixels; `luminance` is one byte per pixel, row-major.
 */
export function decodeQrFromLuminance(
  luminance: Uint8Array | Uint8ClampedArray,
  cols: number,
  rows: number,
  qrDimension?: number,
): LuminanceQrDetection | null {
  // RGBLuminanceSource wants Uint8ClampedArray | Int32Array; XR8 hands a
  // Uint8Array view, so wrap without copying when possible.
  const buf =
    luminance instanceof Uint8ClampedArray
      ? luminance
      : new Uint8ClampedArray(
          luminance.buffer,
          luminance.byteOffset,
          luminance.byteLength,
        );

  const source = new RGBLuminanceSource(buf, cols, rows);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  const reader = new QRCodeReader();

  let result;
  try {
    result = reader.decode(bitmap);
  } catch {
    // NotFoundException / FormatException etc. — no QR this frame. Normal.
    return null;
  }
  if (!result) return null;

  const text = result.getText();
  const payload = parseStationPayload(text);
  const corners =
    payload.kind === "station"
      ? cornersFromResult(result, qrDimension)
      : null;
  return { payload, corners, text };
}
