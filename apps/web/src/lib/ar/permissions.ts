/**
 * AR entrance permissions — camera (required) + iOS device orientation.
 *
 * The docs/dev-journal/2026-04-18-ar-tracking-architecture.md design calls
 * for QR-anchored pose + IMU rotation; both need these two permissions
 * granted up front so the subsequent screens (A2 station picker, A3 QR
 * scan, A4 AR viewing) can assume access.
 *
 * iOS 13+ requires `DeviceOrientationEvent.requestPermission()` to be
 * invoked from an explicit user gesture; this module exposes a single
 * `requestAllArPermissions` entry that bundles both asks into the tap
 * handler on A1.
 */

export type PermissionState = "idle" | "requesting" | "granted" | "denied";

export type ArPermissionsResult = {
  camera: PermissionState;
  orientation: PermissionState;
};

/** Feature-detect iOS Safari's explicit orientation permission flow. */
function hasOrientationPermissionApi(): boolean {
  return (
    typeof DeviceOrientationEvent !== "undefined" &&
    // @ts-expect-error — iOS-only static method; not in the TS DOM lib
    typeof DeviceOrientationEvent.requestPermission === "function"
  );
}

async function requestCamera(): Promise<PermissionState> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "denied";
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    // We only need the grant — release the stream immediately; A3/A4 will
    // re-open it with the tracking-specific constraints.
    stream.getTracks().forEach((t) => t.stop());
    return "granted";
  } catch {
    return "denied";
  }
}

async function requestOrientation(): Promise<PermissionState> {
  if (!hasOrientationPermissionApi()) {
    // Android / desktop grant orientation events without a prompt.
    return "granted";
  }
  try {
    // @ts-expect-error — see hasOrientationPermissionApi
    const response = (await DeviceOrientationEvent.requestPermission()) as
      | "granted"
      | "denied";
    return response === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/**
 * Request both permissions. Camera first so iOS shows its native prompt
 * before orientation (users tend to reject whichever is shown last when
 * fatigued).
 */
export async function requestAllArPermissions(): Promise<ArPermissionsResult> {
  const camera = await requestCamera();
  const orientation = await requestOrientation();
  return { camera, orientation };
}

export function allGranted(r: ArPermissionsResult): boolean {
  return r.camera === "granted" && r.orientation === "granted";
}
