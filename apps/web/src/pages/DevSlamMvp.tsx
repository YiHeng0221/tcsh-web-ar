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
import { loadXR8, loadXRExtras } from "@/lib/slam/load-xr8";
import { decodeQrFromLuminance } from "@/lib/slam/qr-from-luminance";

type SlamStatus = "idle" | "loading" | "starting" | "tracking" | "error";

type Hud = {
  slam: SlamStatus;
  aligned: boolean;
  /** Reprojection error (px) of the solve that produced the alignment. */
  lastReprojPx: number | null;
  /** Last QR text seen (for sanity — is it even our station?). */
  lastQrText: string | null;
  /** Diagnostics: luminance frames read OK vs null, decode attempts, keys seen. */
  lumOk: number;
  lumNull: number;
  decTries: number;
  cpuKeys: string | null;
  /** Camera track zoom capability + applied value ("0.5–8 →0.5" / "n/a"). */
  zoomInfo: string | null;
  /** Actual capture resolution, read off the first luminance frame. */
  capRes: string | null;
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
  /** The pixel-array module's self-reported result key (rename-proof). */
  const cpaKeyRef = useRef<string | null>(null);
  const [hud, setHud] = useState<Hud>({
    slam: "idle",
    aligned: false,
    lastReprojPx: null,
    lastQrText: null,
    lumOk: 0,
    lumNull: 0,
    decTries: 0,
    cpuKeys: null,
    zoomInfo: null,
    capRes: null,
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
    restoreConstraintShim();
  }, []);

  const start = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setHud((h) => ({ ...h, slam: "loading", error: null }));

    // Constraint injection: the engine only sends `min` width/height to
    // getUserMedia on iOS (binary dissection: min 960×720), letting the
    // browser pick a 16:9 sensor-crop mode — the exact "zoom" Mode A had
    // before we forced 4:3. Augment the engine's own video constraints
    // with the Mode A recipe (same lens, full-sensor 4:3) and restore the
    // original API on teardown.
    installConstraintShim();

    let XR8: XR8Static;
    let xrExtras: import("@/lib/slam/load-xr8").XRExtrasStatic;
    try {
      [XR8, xrExtras] = await Promise.all([loadXR8(), loadXRExtras()]);
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
          // Ultra-wide experiment is opt-in only (?wide=1): field test
          // showed switching lenses breaks the engine's calibration hard —
          // QR decode and tracking both die. Kept for future evaluation.
          if (new URLSearchParams(window.location.search).get("wide") === "1") {
            window.setTimeout(() => {
              void tryWidenCamera((info) =>
                setHud((h) => ({ ...h, zoomInfo: info })),
              );
            }, 800);
          }
        }
      },
      onException: (err) => {
        setHud((h) => ({
          ...h,
          slam: "error",
          error: err instanceof Error ? err.message : String(err),
        }));
      },
      onUpdate: ({ processCpuResult, processGpuResult }) => {
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

        const cam = readCameraLuminance(
          processCpuResult,
          processGpuResult,
          cpaKeyRef.current,
        );
        if (!cam) {
          setHud((h) => ({
            ...h,
            lumNull: h.lumNull + 1,
            // Capture both stages' keys once — the binary dissection showed
            // the frame lives in processGpuResult on engine 1.0.
            cpuKeys:
              h.cpuKeys ??
              `cpu:[${
                processCpuResult ? Object.keys(processCpuResult).join(",") : ""
              }] gpu:[${
                processGpuResult ? Object.keys(processGpuResult).join(",") : ""
              }]`,
          }));
          return;
        }
        if (!slamPoseRef.current) return;
        setHud((h) => ({
          ...h,
          lumOk: h.lumOk + 1,
          decTries: h.decTries + 1,
          capRes: h.capRes ?? `${cam.width}×${cam.height}`,
        }));

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
      // Keep the instance: the field showed processCpuResult carrying only
      // [threejsrenderer, reality] — the pixel-array result key drifted from
      // the historical 'camerapixelarray'. Reading the module's OWN .name is
      // rename-proof.
      const cpaModule = XR8.CameraPixelArray.pipelineModule({
        luminance: true,
      });
      cpaKeyRef.current = (cpaModule as { name?: string }).name ?? null;
      XR8.addCameraPipelineModules([
        // Official canvas management (same module the example repo's xrweb
        // uses): fullscreen, aspect-true, rotation-aware. Replaces all the
        // hand-rolled sizing from earlier field rounds.
        xrExtras.FullWindowCanvas.pipelineModule(),
        XR8.GlTextureRenderer.pipelineModule(), // draw the camera feed
        XR8.Threejs.pipelineModule(), // three.js scene + camera
        XR8.XrController.pipelineModule(), // SLAM 6DoF
        // Luminance frames for QR. Half-res keeps decode cheap; the corner
        // pixel coords come back in THIS resolution, which is also what we
        // pass to solveSquarePose, so intrinsics stay self-consistent.
        cpaModule,
        fusionModule,
      ]);
      // Canvas sizing is owned by XRExtras.FullWindowCanvas (official
      // module — fullscreen, aspect-true, rotation-aware).
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
        // Inline style too: the engine writes its own inline sizing on run,
        // which beats the Tailwind classes (field bug: feed rendered as a
        // top strip). Inline-with-!important from us wins the cascade.
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />

      {/* HUD */}
      <div className="safe-area pointer-events-none absolute inset-x-0 top-0 z-[10000] flex items-start justify-between px-4 pt-4 text-xs">
        <div className="pointer-events-auto rounded bg-black/55 px-2 py-1 font-mono leading-5">
          <div>slam: {hud.slam}</div>
          <div>
            lum: ok={hud.lumOk} null={hud.lumNull} dec={hud.decTries}
          </div>
          {hud.capRes && <div>cap: {hud.capRes}</div>}
          {hud.zoomInfo && <div>zoom: {hud.zoomInfo}</div>}
          {hud.cpuKeys && (
            <div>
              keys: {hud.cpuKeys.slice(0, 60)} cpa={cpaKeyRef.current ?? "?"}
            </div>
          )}
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
  processGpuResult: XR8PipelineUpdateArgs["processGpuResult"],
  moduleKey: string | null,
): { data: Uint8Array; width: number; height: number } | null {
  // Engine 1.0 (binary dissection 2026-06-13): the frame is in the GPU
  // stage result. Check it first, fall back to the legacy CPU location.
  const sources = [processGpuResult, processCpuResult].filter(
    Boolean,
  ) as Record<string, unknown>[];
  let cpa: Record<string, unknown> | undefined;
  for (const r of sources) {
    cpa =
      (moduleKey
        ? (r[moduleKey] as Record<string, unknown> | undefined)
        : undefined) ??
      (r.camerapixelarray as Record<string, unknown> | undefined) ??
      (r.cameraPixelArray as Record<string, unknown> | undefined);
    if (cpa) break;
  }
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


/**
 * Try to widen the camera FOV via the track's `zoom` capability (iOS 17+
 * Safari; multi-lens iPhones report ranges below 1 where 0.5 = the
 * ultra-wide lens). The engine owns the getUserMedia stream, so we locate
 * its hidden <video> in the DOM and apply constraints to the live track.
 * Harmless no-op when unsupported — the HUD reports what happened.
 */
async function tryWidenCamera(report: (info: string) => void): Promise<void> {
  const video = Array.from(document.querySelectorAll("video")).find(
    (v) => v.srcObject instanceof MediaStream,
  );
  const track = (video?.srcObject as MediaStream | undefined)
    ?.getVideoTracks()
    .at(0);
  if (!track) {
    report("no-track");
    return;
  }
  type ZoomCaps = MediaTrackCapabilities & {
    zoom?: { min: number; max: number };
  };
  const caps = (
    track.getCapabilities ? track.getCapabilities() : {}
  ) as ZoomCaps;
  if (!caps.zoom) {
    report("n/a");
    return;
  }
  const target = Math.max(caps.zoom.min, 0.5);
  try {
    await track.applyConstraints({
      advanced: [{ zoom: target } as MediaTrackConstraintSet],
    });
    report(`${caps.zoom.min}–${caps.zoom.max} →${target}`);
  } catch (err) {
    report(`failed:${err instanceof Error ? err.message : String(err)}`);
  }
}


// ── getUserMedia constraint shim ──────────────────────────────────────────
// Augments video constraints with the Mode A 4:3 recipe while the SLAM page
// is active. Same lens (no facingMode/deviceId change), just a full-sensor
// capture mode instead of the browser's default 16:9 crop.
let originalGetUserMedia:
  | ((constraints?: MediaStreamConstraints) => Promise<MediaStream>)
  | null = null;

function installConstraintShim(): void {
  if (originalGetUserMedia || !navigator.mediaDevices?.getUserMedia) return;
  const md = navigator.mediaDevices;
  originalGetUserMedia = md.getUserMedia.bind(md);
  md.getUserMedia = (constraints?: MediaStreamConstraints) => {
    if (constraints && typeof constraints.video === "object") {
      constraints = {
        ...constraints,
        video: {
          ...constraints.video,
          width: { ideal: 1920 },
          height: { ideal: 1440 },
          aspectRatio: { ideal: 4 / 3 },
        },
      };
    }
    return originalGetUserMedia!(constraints);
  };
}

function restoreConstraintShim(): void {
  if (originalGetUserMedia && navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    originalGetUserMedia = null;
  }
}
