/**
 * AR entrance permissions — camera (required) + iOS device orientation.
 *
 * The docs/dev-journal/2026-04-18-ar-tracking-architecture.md design calls
 * for QR-anchored pose + IMU rotation; both need these two permissions
 * granted up front so the subsequent screens (A2 station picker, A3 QR
 * scan, A4 AR viewing) can assume access.
 *
 * iOS 13+ requires `DeviceOrientationEvent.requestPermission()` to be
 * invoked from an explicit user gesture. Critically, WebKit treats that
 * gesture ("transient activation") as consumed by the first `await`
 * that outlasts the gesture — calling requestPermission AFTER awaiting
 * `getUserMedia` raises NotAllowedError. We dispatch both permission
 * asks synchronously inside the same tap handler and only await the
 * returned promises afterwards.
 */

export type PermissionState = "idle" | "requesting" | "granted" | "denied";

export type ArPermissionsResult = {
  camera: PermissionState;
  orientation: PermissionState;
};

/**
 * Typed view of Safari iOS 13+'s static `requestPermission` on the
 * DeviceOrientationEvent constructor. The TS DOM lib doesn't model it,
 * so we narrow via `unknown` once here instead of sprinkling
 * `@ts-expect-error` at each call site.
 */
type DeviceOrientationEventIOS = {
  requestPermission?: () => Promise<"granted" | "denied">;
};

function getOrientationCtor(): DeviceOrientationEventIOS | null {
  if (typeof DeviceOrientationEvent === "undefined") return null;
  return DeviceOrientationEvent as unknown as DeviceOrientationEventIOS;
}

/**
 * Synchronously dispatch the camera request. Returns the promise so the
 * caller can await it *after* also dispatching the orientation request
 * — that way both asks hold their claim on the same user activation.
 */
function dispatchCameraRequest(): Promise<PermissionState> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return Promise.resolve<PermissionState>("denied");
  }
  return navigator.mediaDevices
    .getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    })
    .then<PermissionState>((stream) => {
      // We only need the grant — release the stream immediately; A3/A4 will
      // re-open it with the tracking-specific constraints.
      stream.getTracks().forEach((t) => t.stop());
      return "granted";
    })
    .catch<PermissionState>(() => "denied");
}

/** Synchronously dispatch the orientation request (or resolve "granted" on
 *  Android / desktop where no prompt exists). */
function dispatchOrientationRequest(): Promise<PermissionState> {
  const ctor = getOrientationCtor();
  if (!ctor || typeof ctor.requestPermission !== "function") {
    return Promise.resolve<PermissionState>("granted");
  }
  try {
    return ctor
      .requestPermission()
      .then<PermissionState>((response) =>
        response === "granted" ? "granted" : "denied",
      )
      .catch<PermissionState>(() => "denied");
  } catch {
    // Thrown synchronously if the call isn't tied to a user gesture.
    return Promise.resolve<PermissionState>("denied");
  }
}

/**
 * Request camera + orientation from a single tap.
 *
 * MUST be called synchronously from a user gesture handler. Both asks
 * are queued before any await so iOS Safari sees them as part of the
 * same activation window.
 */
export async function requestAllArPermissions(): Promise<ArPermissionsResult> {
  const cameraPromise = dispatchCameraRequest();
  const orientationPromise = dispatchOrientationRequest();
  const [camera, orientation] = await Promise.all([
    cameraPromise,
    orientationPromise,
  ]);
  return { camera, orientation };
}

export function allGranted(r: ArPermissionsResult): boolean {
  return r.camera === "granted" && r.orientation === "granted";
}
