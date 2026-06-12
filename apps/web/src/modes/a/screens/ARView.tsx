/**
 * ARView — Mode A's single deep-link AR surface (spec §0.5, A3 + A4 merged).
 *
 * Flow (spec §0.5 "全程使用流程, 二次修訂"):
 *
 *   ┌──────────────────┐  tap "開始 AR"   ┌────────────┐  QR solve OK   ┌──────────┐
 *   │ permission-gate  │ ───────────────► │  scanning  │ ─────────────► │ viewing  │
 *   │ (first visit /   │  (camera+motion  │ camera +   │  (reproj≤8px)  │ AR fades │
 *   │  not yet granted)│   from gesture)  │ QR loop +  │                │ in; QR   │
 *   └──────────────────┘                  │ OpenCV     │ ◄───────────── │ loop @2fps│
 *           │ already granted             │ load       │  re-snap /     │ re-snaps  │
 *           └────────────────────────────►└────────────┘  station change└────┬─────┘
 *                                              ▲                              │ coast >10s
 *                                              │  re-aim (toast)              ▼
 *                                              └──────────────────────  [coasting]
 *
 * The camera surface (`<video>`) is the SAME element across scanning and
 * viewing — the AR content fades over the live feed, it is not a new screen.
 *
 * Resource ownership: every long-lived resource (camera stream, QrDetector,
 * ImuTracker, the OpenCV handle) is held in a ref and torn down in a single
 * `releaseAll()` that runs on unmount AND before the mode-switch navigation
 * (spec §0.5: "切到 B … 確實釋放相機與所有資源"; REVIEW.md red lines on
 * camera / zxing / IMU leaks). Three.js disposal lives in ARScene.
 *
 * iOS permission rule: `requestAllArPermissions()` is dispatched synchronously
 * from the "開始 AR" tap handler (permissions.ts blood-lesson — the orientation
 * ask must ride the same user activation as the camera ask).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { closeArCamera, openArCamera } from "@/lib/ar/camera";
import {
  allGranted,
  requestAllArPermissions,
} from "@/lib/ar/permissions";
import { PnpWorkerClient } from "@/lib/ar/pnp-client";
import {
  QrDetector,
  type QrDetection,
} from "@/lib/ar/qr-detector";
import { ImuTracker } from "@/lib/ar/imu";
import { PoseFusion } from "@/lib/ar/pose-fusion";
import { MOCK_QR_SIZE_MM } from "@/lib/ar/mock-placements";

import ARScene from "../components/ARScene";
import RecalibrateToast from "../components/RecalibrateToast";
import ScanReticle, { type ReticleState } from "../components/ScanReticle";
import { usePlacements } from "../usePlacements";

type Phase = "permission-gate" | "scanning" | "viewing";

/**
 * Field-debug counters (HUD enabled with `?debug=1`). Mutated from the
 * hot detection path via ref (no re-renders); a 2Hz interval snapshots
 * them into state. The HUD exists because every failure mode of the
 * scan→solve pipeline is silent by design (keep scanning, never crash) —
 * on a real device we need the phone itself to say which gate rejects.
 */
type DiagCounters = {
  attempts: number;
  decodes: number;
  foreign: number;
  noCorners: number;
  cvNotReady: number;
  solveRejected: number;
  solveOk: number;
  lastStation: string | null;
  lastReprojPx: number | null;
};

const freshDiag = (): DiagCounters => ({
  attempts: 0,
  decodes: 0,
  foreign: 0,
  noCorners: 0,
  cvNotReady: 0,
  solveRejected: 0,
  solveOk: 0,
  lastStation: null,
  lastReprojPx: null,
});

/** QR scan throttle while viewing — low-frequency recalibration (spec §0.5). */
const VIEWING_SCAN_THROTTLE_MS = 500; // ~2fps

/**
 * QR physical edge length (mm). The real value is `AnchorOut.size_mm` from the
 * API; until the anchor fetch is wired into this screen we use the demo sheet
 * size so solvePnP scale is correct against the printed demo QR.
 * TODO(api): read size_mm from the anchor record once anchors are fetched here.
 */
const QR_SIZE_MM = MOCK_QR_SIZE_MM;

export default function ARView() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ stationId: string }>();
  const [stationId, setStationId] = useState<string | undefined>(
    params.stationId,
  );
  // Field-debug HUD. Always on under the dev server (the printed QR's
  // URL has no query param, and asking testers to retype ?debug=1 after
  // every rescan proved error-prone in the field). Prod builds require
  // the explicit ?debug=1 opt-in.
  const debugEnabled = useMemo(
    () =>
      import.meta.env.DEV ||
      new URLSearchParams(location.search).get("debug") === "1",
    [location.search],
  );
  const diagRef = useRef<DiagCounters>(freshDiag());
  const [diag, setDiag] = useState<DiagCounters>(freshDiag());

  const [phase, setPhase] = useState<Phase>("permission-gate");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [opencvReady, setOpencvReady] = useState(false);
  const [opencvError, setOpencvError] = useState<string | null>(null);
  const cvLoadStartRef = useRef<number | null>(null);
  const [reticle, setReticle] = useState<ReticleState>("preparing");
  const [needsRecalibration, setNeedsRecalibration] = useState(false);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(
    null,
  );

  const { placements } = usePlacements(stationId);

  // ── Long-lived resources (refs, never re-created on render) ───────────────
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<QrDetector | null>(null);
  const imuRef = useRef<ImuTracker | null>(null);
  const pnpRef = useRef<PnpWorkerClient | null>(null);
  const fusionRef = useRef<PoseFusion>(new PoseFusion());
  const mountedRef = useRef(true);
  // Latest-known phase / station for callbacks that outlive a render.
  const phaseRef = useRef<Phase>(phase);
  const stationIdRef = useRef<string | undefined>(stationId);
  phaseRef.current = phase;
  stationIdRef.current = stationId;

  /** Tear down every owned resource. Idempotent; safe to call repeatedly. */
  const releaseAll = useCallback(() => {
    detectorRef.current?.dispose();
    detectorRef.current = null;
    imuRef.current?.dispose();
    imuRef.current = null;
    if (streamRef.current) {
      closeArCamera(streamRef.current);
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    // Terminating the worker frees the OpenCV WASM heap with it. Re-entry
    // pays the compile again — but in a worker, so the UI never notices.
    pnpRef.current?.dispose();
    pnpRef.current = null;
  }, []);

  // ── A QR detection (shared by scanning + viewing recalibration loops) ─────
  const handleDetection = useCallback(
    (detection: QrDetection) => {
      if (!mountedRef.current) return;
      const pnp = pnpRef.current;
      const video = videoRef.current;
      const diag = diagRef.current;
      diag.decodes += 1;
      if (detection.payload.kind !== "station") {
        diag.foreign += 1;
        return;
      }
      const corners = detection.corners;
      if (!corners) {
        diag.noCorners += 1;
        return;
      }
      if (!pnp || pnp.state !== "ready") {
        // Worker still compiling OpenCV (or failed) — don't queue a flood
        // of stale solves; the next detection after ready will land.
        diag.cvNotReady += 1;
        return;
      }
      if (!video) return;

      const detectedStation = detection.payload.stationId;
      diag.lastStation = detectedStation;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w === 0 || h === 0) return;

      // Solve happens in the worker; the pose lands asynchronously. The
      // applier re-checks liveness — the phase may have changed (or the
      // screen unmounted) during the round-trip.
      void (async () => {
        const pose = await pnp.solve(corners, QR_SIZE_MM, w, h);
        if (!mountedRef.current) return;
        if (!pose) {
          diag.solveRejected += 1;
          return; // reproj gate failed — don't snap a bad solve
        }
        diag.solveOk += 1;
        diag.lastReprojPx = pose.reprojErrorPx;

        // A different station's QR entered frame → re-anchor to it (spec
        // §0.5: "不同站 QR = 換錨, placements 換站重取"). Reset fusion so
        // we don't blend two anchors' poses.
        if (detectedStation !== stationIdRef.current) {
          fusionRef.current = new PoseFusion();
          setStationId(detectedStation);
          // Keep the URL honest so a refresh / share lands on the same anchor.
          navigate(`/a/view/${detectedStation}`, { replace: true });
        }

        fusionRef.current.pushQrPose(pose);

        // First good lock in scanning → transition to viewing.
        if (phaseRef.current === "scanning") {
          setReticle("locked");
          if (typeof navigator !== "undefined" && navigator.vibrate) {
            navigator.vibrate(50);
          }
          // Brief beat on the green reticle before the AR content fades in.
          window.setTimeout(() => {
            if (mountedRef.current) setPhase("viewing");
          }, 600);
        }
      })();
    },
    [navigate],
  );

  // ── Wire an already-open camera stream into the full tracking pipeline ─────
  // Shared by the gesture path (handleStart) and the silent-grant probe on
  // mount, so the camera-attach + IMU + OpenCV + detector setup lives once.
  const attachPipeline = useCallback(
    async (stream: MediaStream) => {
      streamRef.current = stream;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.muted = true;
        try {
          await video.play();
        } catch {
          // Autoplay can reject if the gesture lapsed; the feed still attaches
          // and plays on the next user interaction. Non-fatal.
        }
        if (!mountedRef.current) return;
        if (video.videoWidth > 0) {
          setVideoSize({ w: video.videoWidth, h: video.videoHeight });
        }
      }

      // IMU: permission already granted up front; tracker just subscribes.
      imuRef.current = new ImuTracker({
        onQuaternion: (q) => fusionRef.current.setImu(q),
        // Landscape is out of scope (spec §6): on screen rotation we drop back
        // to scanning so the user re-aims in portrait.
        onOrientationChange: () => {
          if (mountedRef.current) {
            fusionRef.current = new PoseFusion();
            setPhase("scanning");
            setReticle("scanning");
          }
        },
      });

      // OpenCV loads in parallel with the camera coming up (spec §0.5: load in
      // the background, show a preparing state). The detector starts now but
      // solves are gated on cvRef being populated inside handleDetection.
      // OpenCV lives in a Web Worker (pnp-worker.ts) — loading its ~11 MB
      // module on the main thread froze the entire page on iPhone Safari
      // (field bug 2026-06-13: HUD dead at 0s, attempts=0, taps ignored).
      // The worker compiles off-thread; the scan loop runs immediately.
      cvLoadStartRef.current = performance.now();
      const pnp = new PnpWorkerClient();
      pnp.onStateChange = (state) => {
        if (!mountedRef.current) return;
        if (state === "ready") setOpencvReady(true);
        if (state === "failed") {
          setOpencvError(pnp.error ?? "worker failed");
        }
      };
      pnpRef.current = pnp;

      // The QR detector's lifecycle is owned by the phase effect below (it
      // sets the right throttle for scanning vs viewing); we only flip the
      // phase here and let that effect spin the detector up.
      if (mountedRef.current) {
        setPhase("scanning");
        setReticle("scanning");
      }
    },
    // Only touches refs + state setters (all stable); no reactive deps.
    [],
  );

  // ── Permission gate: skip it if the grant already exists ──────────────────
  // We can't synchronously query getUserMedia / orientation grants reliably on
  // iOS, so we try a silent camera open on mount. If it succeeds the user has
  // already granted (a prior visit) and we go straight to scanning; if it
  // throws we show the "開始 AR" button so the (re)grant rides a user gesture.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let probe: MediaStream;
      try {
        probe = await openArCamera();
      } catch {
        return; // no standing grant — stay on the permission gate
      }
      if (cancelled || !mountedRef.current) {
        closeArCamera(probe);
        return;
      }
      await attachPipeline(probe);
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only probe; attachPipeline is a stable (deps: []) useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The "開始 AR" tap: request both permissions synchronously, then start.
  const handleStart = useCallback(async () => {
    setRequesting(true);
    setPermissionDenied(false);
    // MUST be the synchronous first call of the gesture (permissions.ts).
    const result = await requestAllArPermissions();
    if (!mountedRef.current) return;
    setRequesting(false);
    if (!allGranted(result)) {
      setPermissionDenied(true);
      return;
    }
    if (streamRef.current) return; // probe already opened it
    let stream: MediaStream;
    try {
      stream = await openArCamera();
    } catch {
      if (mountedRef.current) setPermissionDenied(true);
      return;
    }
    if (!mountedRef.current) {
      closeArCamera(stream);
      return;
    }
    await attachPipeline(stream);
  }, [attachPipeline]);

  // ── QR detector lifecycle, tied to the phase ──────────────────────────────
  // scanning wants ~10fps; viewing drops to ~2fps background recalibration
  // (spec §0.5). QrDetector's throttle is fixed at construction, so each phase
  // owns a freshly-built detector and disposes it on the way out — that single
  // dispose path is also the REVIEW.md red-line cleanup for the zxing reader +
  // frame loop. permission-gate has no camera yet, so no detector.
  useEffect(() => {
    if (phase === "permission-gate") return;
    const video = videoRef.current;
    if (!video) return;
    const detector = new QrDetector({
      throttleMs: phase === "viewing" ? VIEWING_SCAN_THROTTLE_MS : 100,
      onDetection: handleDetection,
      onAttempt: () => {
        diagRef.current.attempts += 1;
      },
    });
    detector.start(video);
    detectorRef.current = detector;
    return () => {
      detector.dispose();
      if (detectorRef.current === detector) detectorRef.current = null;
    };
  }, [phase, handleDetection]);

  // ── Poll fusion for the coasting/recalibration signal (cheap, 1Hz) ────────
  useEffect(() => {
    if (phase !== "viewing") {
      setNeedsRecalibration(false);
      return;
    }
    const id = window.setInterval(() => {
      const pose = fusionRef.current.getPose();
      setNeedsRecalibration(pose.needsRecalibration);
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // ── Debug HUD: snapshot the hot-path counters at 2Hz ──────────────────────
  useEffect(() => {
    if (!debugEnabled) return;
    const id = window.setInterval(() => {
      setDiag({ ...diagRef.current });
    }, 500);
    return () => window.clearInterval(id);
  }, [debugEnabled]);

  // ── Capture the intrinsic video size once metadata arrives ────────────────
  const handleVideoMeta = useCallback(() => {
    const video = videoRef.current;
    if (video && video.videoWidth > 0) {
      setVideoSize({ w: video.videoWidth, h: video.videoHeight });
    }
  }, []);

  // ── Unmount: release everything ───────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseAll();
    };
  }, [releaseAll]);

  // ── Mode switch A → B: release the camera, then navigate ──────────────────
  const switchToModeB = useCallback(() => {
    releaseAll();
    navigate("/b");
  }, [navigate, releaseAll]);

  const reticleHint = useMemo(() => {
    if (opencvError) return "辨識引擎載入失敗，請重新整理頁面";
    if (!opencvReady) return "準備中…";
    return "對準地面的 QR";
  }, [opencvReady, opencvError]);

  const effectiveVideoSize = videoSize ?? { w: 1280, h: 720 };

  return (
    <main
      data-mode="a"
      data-screen="ar-view"
      data-phase={phase}
      className="relative h-dvh w-screen overflow-hidden bg-black"
    >
      {/* Fullbleed live camera — the one surface for scanning AND viewing. */}
      <video
        ref={videoRef}
        onLoadedMetadata={handleVideoMeta}
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* AR content fades over the video once we lock (spec §0.5). */}
      {phase === "viewing" && videoSize && (
        <div className="absolute inset-0 animate-[ar-fade-in_500ms_ease-out_forwards] opacity-0">
          <Canvas
            gl={{ alpha: true }}
            camera={{ fov: 60, near: 0.01, far: 100 }}
            className="!absolute inset-0"
          >
            <ARScene
              fusion={fusionRef.current}
              placements={placements}
              videoWidth={effectiveVideoSize.w}
              videoHeight={effectiveVideoSize.h}
            />
          </Canvas>
        </div>
      )}

      {/* Scan framing overlay (scanning + viewing keep the reticle subtle so
          the visitor knows re-aiming recalibrates). */}
      {phase === "scanning" && (
        <ScanReticle state={reticle} hint={reticleHint} />
      )}

      {phase === "viewing" && (
        <RecalibrateToast visible={needsRecalibration} />
      )}

      {/* Top-right mode switch (A ↔ B). Releases the camera on switch. */}
      {phase !== "permission-gate" && (
        <div className="safe-area pointer-events-none absolute inset-x-0 top-0 flex justify-end px-4 pt-4">
          <button
            type="button"
            onClick={switchToModeB}
            className="pointer-events-auto rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-fg backdrop-blur"
            aria-label="切換到 3D 檢視（Mode B）"
          >
            AR ｜ <span className="text-muted">3D</span>
          </button>
        </div>
      )}

      {/* Permission gate — the one mandatory tap (iOS user-activation rule). */}
      {phase === "permission-gate" && (
        <div className="safe-area absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black/80 px-8 text-center backdrop-blur">
          <h1 className="text-xl font-medium text-fg">準備好開始 AR 了嗎？</h1>
          <p className="max-w-xs text-sm text-muted">
            對準地面的 QR，作品會疊在你眼前。需要相機與方位權限。
          </p>
          <button
            type="button"
            onClick={handleStart}
            disabled={requesting}
            className="h-14 w-full max-w-xs rounded-xl bg-accent text-base font-semibold text-black transition-opacity disabled:opacity-60"
          >
            {requesting ? "請求權限中…" : "開始 AR"}
          </button>
          {permissionDenied && (
            <p className="text-xs text-danger">
              相機或方位權限未授予。請到瀏覽器設定允許後再試一次。
            </p>
          )}
        </div>
      )}

      {/* Field-debug HUD (?debug=1) — which silent gate is rejecting? */}
      {debugEnabled && (
        <div className="safe-area pointer-events-none absolute inset-x-0 bottom-0 z-50 px-3 pb-3 font-mono text-[10px] leading-tight text-lime-300">
          <div className="rounded bg-black/70 p-2">
            <div>
              phase={phase} cv=
              {opencvError
                ? `FAILED:${opencvError.slice(0, 40)}`
                : opencvReady
                  ? "ready"
                  : `loading(${
                      cvLoadStartRef.current != null
                        ? Math.round(
                            (performance.now() - cvLoadStartRef.current) / 1000,
                          )
                        : 0
                    }s)`}{" "}
              video={videoSize ? `${videoSize.w}×${videoSize.h}` : "—"} station=
              {stationId ?? "—"}
            </div>
            <div>
              attempts={diag.attempts} decodes={diag.decodes} foreign=
              {diag.foreign} noCorners={diag.noCorners} cvWait={diag.cvNotReady}
            </div>
            <div>
              solveOk={diag.solveOk} solveRej={diag.solveRejected} reproj=
              {diag.lastReprojPx != null ? diag.lastReprojPx.toFixed(1) : "—"}px
              lastQR={diag.lastStation ?? "—"}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes ar-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </main>
  );
}
