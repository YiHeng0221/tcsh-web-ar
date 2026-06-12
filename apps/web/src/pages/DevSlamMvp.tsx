/**
 * Dev sandbox (`/dev/slam-mvp`): 8th Wall SLAM **walking-AR** MVP.
 *
 * Goal a tester can see with their own eyes: point the phone at the floor QR,
 * the six mock placements snap into the world, then you *walk around* and they
 * stay pinned in place — growing as you approach, shrinking as you back off.
 * This is the parallel experiment to Mode A's QR+IMU path (which assumes the
 * user stands still at a station); here SLAM owns translation.
 *
 * Pipeline (all outside React's render — XR8 drives its own three.js loop):
 *   1. User taps Start (iOS gesture gate for camera + motion permission).
 *   2. `loadXR8()` injects the engine binary; we build a three.js pipeline:
 *      GlTextureRenderer (camera feed) + XrController (SLAM 6DoF) +
 *      Threejs (scene/camera) + CameraPixelArray (luminance frames for QR) +
 *      our own module that (a) caches the latest SLAM camera pose every frame
 *      and (b) throttles QR decode off the luminance buffer.
 *   3. On the first trustworthy QR solve we sample (SLAM pose, anchor pose) at
 *      the same instant, compute T_slam←anchor, and add the MOCK_PLACEMENTS to
 *      the XR8 scene mapped through T. From then on SLAM keeps them world-locked.
 *
 * Desktop has no SLAM/IMU; we detect coarse-grained and show a "use your phone"
 * notice instead of starting (the engine would just fail to track).
 *
 * NOTE: This route is intentionally NOT wired into Mode A. It's a spike to
 * prove the SLAM fusion before any integration decision.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  TextureLoader,
  Vector3,
} from "three";

import {
  MOCK_PLACEMENTS,
  MOCK_QR_SIZE_MM,
  MOCK_STATION_ID,
} from "@/lib/ar/mock-placements";
import { solveSquarePose } from "@/lib/ar/ippe";
import { applyAlignment, computeAlignment } from "@/lib/slam/alignment";
import { loadXR8 } from "@/lib/slam/load-xr8";
import { decodeQrFromLuminance } from "@/lib/slam/qr-from-luminance";

type SlamStatus = "idle" | "loading" | "starting" | "tracking" | "error";

type Hud = {
  slam: SlamStatus;
  aligned: boolean;
  /** Reprojection error (px) of the solve that produced the alignment. */
  lastReprojPx: number | null;
  /** Last QR text seen (for sanity — is it even our station?). */
  lastQrText: string | null;
  error: string | null;
};

/** Coarse mobile check — SLAM + IMU only make sense on a phone/tablet. */
function isLikelyMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const touch =
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0);
  return /android|iphone|ipad|ipod|mobile/i.test(ua) && touch;
}

export default function DevSlamMvp() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hud, setHud] = useState<Hud>({
    slam: "idle",
    aligned: false,
    lastReprojPx: null,
    lastQrText: null,
    error: null,
  });
  const [mobile] = useState(isLikelyMobile);
  const startedRef = useRef(false);

  // Latest SLAM camera pose, written every frame by the pipeline module and
  // read at the QR-solve instant. Lives in a ref so the hot loop never touches
  // React state.
  const slamPoseRef = useRef<{
    position: Vector3;
    quaternion: Quaternion;
  } | null>(null);
  const alignedRef = useRef(false);
  const lastQrAttemptRef = useRef(0);

  const stop = useCallback(() => {
    const XR8 = window.XR8;
    try {
      XR8?.stop();
      XR8?.clearCameraPipelineModules();
    } catch {
      // best-effort teardown
    }
  }, []);

  const start = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setHud((h) => ({ ...h, slam: "loading", error: null }));

    let XR8: XR8Static;
    try {
      XR8 = await loadXR8();
    } catch (e) {
      startedRef.current = false;
      setHud((h) => ({
        ...h,
        slam: "error",
        error: e instanceof Error ? e.message : "engine load failed",
      }));
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      startedRef.current = false;
      setHud((h) => ({ ...h, slam: "error", error: "canvas missing" }));
      return;
    }

    setHud((h) => ({ ...h, slam: "starting" }));

    // Module: cache SLAM pose + decode QR off luminance + place on first solve.
    const fusionModule: XR8CameraPipelineModule = {
      name: "tcsh-slam-fusion",
      onCameraStatusChange: ({ status }) => {
        if (status === "hasStream" || status === "hasVideo") {
          setHud((h) => ({ ...h, slam: "tracking" }));
        }
      },
      onException: (err) => {
        setHud((h) => ({
          ...h,
          slam: "error",
          error: err instanceof Error ? err.message : String(err),
        }));
      },
      onUpdate: ({ processCpuResult }) => {
        const reality = processCpuResult?.reality;
        if (reality) {
          const p = reality.position;
          const r = reality.rotation;
          slamPoseRef.current = {
            position: new Vector3(p.x, p.y, p.z),
            quaternion: new Quaternion(r.x, r.y, r.z, r.w),
          };
          if (hud.slam !== "tracking") {
            setHud((h) =>
              h.slam === "tracking" ? h : { ...h, slam: "tracking" },
            );
          }
        }

        if (alignedRef.current) return; // placements already pinned

        // Throttle QR decode to ~6fps — it's the expensive part, and we only
        // need ONE good solve to lock the alignment.
        const now =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        if (now - lastQrAttemptRef.current < 160) return;
        lastQrAttemptRef.current = now;

        const cam = readCameraLuminance(processCpuResult);
        if (!cam || !slamPoseRef.current) return;

        const detection = decodeQrFromLuminance(cam.data, cam.width, cam.height);
        if (!detection) return;

        setHud((h) => ({ ...h, lastQrText: detection.text }));
        if (detection.payload.kind !== "station" || !detection.corners) return;

        const solved = solveSquarePose(
          detection.corners,
          MOCK_QR_SIZE_MM,
          cam.width,
          cam.height,
        );
        if (!solved) return;

        // Sample both poses at this instant and lock the alignment.
        const T = computeAlignment(
          { position: solved.position, quaternion: solved.quaternion },
          slamPoseRef.current,
        );
        addPlacementsToScene(XR8, T);
        alignedRef.current = true;
        setHud((h) => ({
          ...h,
          aligned: true,
          lastReprojPx: solved.reprojErrorPx,
        }));
      },
    };

    try {
      XR8.addCameraPipelineModules([
        XR8.GlTextureRenderer.pipelineModule(), // draw the camera feed
        XR8.Threejs.pipelineModule(), // three.js scene + camera
        XR8.XrController.pipelineModule(), // SLAM 6DoF
        // Luminance frames for QR. Half-res keeps decode cheap; the corner
        // pixel coords come back in THIS resolution, which is also what we
        // pass to solveSquarePose, so intrinsics stay self-consistent.
        XR8.CameraPixelArray.pipelineModule({ luminance: true }),
        fusionModule,
      ]);
      XR8.run({ canvas });
    } catch (e) {
      startedRef.current = false;
      setHud((h) => ({
        ...h,
        slam: "error",
        error: e instanceof Error ? e.message : "XR8.run failed",
      }));
    }
  }, [hud.slam]);

  useEffect(() => () => stop(), [stop]);

  return (
    <main
      data-screen="dev-slam-mvp"
      className="relative h-dvh w-screen overflow-hidden bg-black text-white"
    >
      {/* XR8 renders the camera feed + three scene into this canvas. */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        // The engine sizes the backing store itself.
      />

      {/* HUD */}
      <div className="safe-area pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between px-4 pt-4 text-xs">
        <div className="pointer-events-auto rounded bg-black/55 px-2 py-1 font-mono leading-5">
          <div>slam: {hud.slam}</div>
          <div>aligned: {hud.aligned ? "Y" : "n"}</div>
          <div>
            reproj:{" "}
            {hud.lastReprojPx == null
              ? "—"
              : `${hud.lastReprojPx.toFixed(2)}px`}
          </div>
          {hud.lastQrText && (
            <div className="max-w-[60vw] truncate opacity-70">
              qr: {hud.lastQrText}
            </div>
          )}
          {hud.error && (
            <div className="text-red-400">err: {hud.error}</div>
          )}
        </div>
        <Link
          to="/"
          className="pointer-events-auto rounded bg-black/55 px-2 py-1 text-accent"
        >
          ← landing
        </Link>
      </div>

      {/* Start overlay (camera/motion permission needs a user gesture). */}
      {hud.slam === "idle" || hud.slam === "error" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 px-6 text-center">
          {!mobile ? (
            <>
              <p className="text-base font-semibold">請用手機開啟</p>
              <p className="max-w-xs text-sm text-white/70">
                這個 SLAM 走動 AR 需要手機的相機與動作感測器。桌機沒有
                IMU，引擎無法追蹤。掃描下方 QR 或在手機瀏覽器開
                <code className="mx-1 rounded bg-white/10 px-1">
                  /dev/slam-mvp
                </code>
                。
              </p>
            </>
          ) : (
            <>
              <p className="text-base font-semibold">8th Wall SLAM 走動 AR</p>
              <p className="max-w-xs text-sm text-white/70">
                對準地面的 {MOCK_STATION_ID} QR，貼圖會釘在原地——走近會變大、
                走遠會變小。
              </p>
            </>
          )}
          {hud.error && (
            <p className="max-w-xs text-sm text-red-400">{hud.error}</p>
          )}
          <button
            type="button"
            onClick={() => void start()}
            className="pointer-events-auto rounded-full bg-accent px-6 py-3 text-base font-semibold text-black"
          >
            {hud.slam === "error" ? "重試" : "開始"}
          </button>
        </div>
      ) : null}

      {(hud.slam === "loading" || hud.slam === "starting") && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 text-center text-sm text-white/80">
          {hud.slam === "loading" ? "載入 SLAM 引擎…" : "啟動相機…"}
        </div>
      )}
    </main>
  );
}

/**
 * Pull a luminance frame out of the pipeline result. XR8's
 * `CameraPixelArray.pipelineModule({ luminance: true })` exposes the frame under
 * `processCpuResult.camerapixelarray` as `{ pixels, rows, cols }` (the engine's
 * historical shape). We read defensively because the exact key/shape can drift
 * between engine versions.
 */
function readCameraLuminance(
  processCpuResult: XR8PipelineUpdateArgs["processCpuResult"],
): { data: Uint8Array; width: number; height: number } | null {
  if (!processCpuResult) return null;
  const r = processCpuResult as Record<string, unknown>;
  const cpa =
    (r.camerapixelarray as Record<string, unknown> | undefined) ??
    (r.cameraPixelArray as Record<string, unknown> | undefined);
  if (!cpa) return null;

  const pixels = cpa.pixels as ArrayLike<number> | undefined;
  const cols = (cpa.cols ?? cpa.width) as number | undefined;
  const rows = (cpa.rows ?? cpa.height) as number | undefined;
  if (!pixels || !cols || !rows) return null;

  // `pixels` is luminance (1 byte/pixel) when luminance:true. Coerce to a
  // Uint8Array view without copying when it already is one.
  const data =
    pixels instanceof Uint8Array
      ? pixels
      : Uint8Array.from(pixels as ArrayLike<number>);
  if (data.length < cols * rows) return null;
  return { data, width: cols, height: rows };
}

/**
 * Build a textured quad per mock placement, map its anchor-frame transform into
 * the SLAM world through the alignment T, and add it to the XR8 three.js scene.
 */
function addPlacementsToScene(XR8: XR8Static, alignment: import("three").Matrix4): void {
  const { scene } = XR8.Threejs.xrScene();
  const loader = new TextureLoader();
  const geometry = new PlaneGeometry(1, 1);

  for (const p of MOCK_PLACEMENTS) {
    const world = applyAlignment(alignment, {
      position: new Vector3(...p.position),
      quaternion: new Quaternion(...p.rotation),
      scale: new Vector3(...p.scale),
    });
    const material = new MeshBasicMaterial({
      map: loader.load(p.textureUrl),
      side: DoubleSide,
      toneMapped: false,
      transparent: true,
    });
    const mesh = new Mesh(geometry, material);
    mesh.position.copy(world.position);
    mesh.quaternion.copy(world.quaternion);
    mesh.scale.copy(world.scale);
    scene.add(mesh);
  }
}
