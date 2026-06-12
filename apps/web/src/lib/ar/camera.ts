/**
 * Camera stream lifecycle for AR (spec §6 camera).
 *
 * Opens the rear ("environment") camera at the tracking resolution. We ask
 * for `facingMode: { exact: "environment" }` first so a device with a front
 * camera never silently hands us the selfie cam; if that throws
 * (OverconstrainedError on hardware without a back cam — e.g. a desktop
 * webcam used for dev), we fall back to the softer `ideal` constraint.
 *
 * This wrapper does NOT attach the stream to a <video>; the caller owns the
 * element and sets `videoEl.srcObject`. Permission is assumed already
 * granted at A1 (permissions.ts).
 */

const TRACKING_VIDEO: MediaTrackConstraints = {
  // 4:3, not 16:9: every 16:9 video mode is a vertical crop of the 4:3
  // sensor, which is why 720p/1080p both look "zoomed in" next to the
  // native camera app (whose preview is 4:3). Asking for 1920×1440
  // keeps the full sensor FOV; intrinsics in coords.ts scale with the
  // actual delivered frame size, so pose math is unaffected.
  width: { ideal: 1920 },
  height: { ideal: 1440 },
  aspectRatio: { ideal: 4 / 3 },
};

export async function openArCamera(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("getUserMedia unavailable (needs a secure context)");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { ...TRACKING_VIDEO, facingMode: { exact: "environment" } },
      audio: false,
    });
  } catch {
    // No exact rear camera (dev webcam, or device lies about facingMode) —
    // retry with the soft preference so dev on a laptop still works.
    return navigator.mediaDevices.getUserMedia({
      video: { ...TRACKING_VIDEO, facingMode: { ideal: "environment" } },
      audio: false,
    });
  }
}

/** Stop every track so the camera LED goes off (spec §6: stop all tracks). */
export function closeArCamera(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
