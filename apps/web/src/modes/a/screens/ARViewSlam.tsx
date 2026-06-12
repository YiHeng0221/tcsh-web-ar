/**
 * ARViewSlam — Mode A v3's primary on-site AR surface (spec
 * `2026-06-13-mode-a-slam-integration.md`).
 *
 * The field-verified SLAM walking-AR path, promoted from the `/dev/slam-mvp`
 * spike into a real Mode A screen. Unlike the legacy `ARView` (QR + IMU, user
 * assumed stationary at a station), here 8th Wall SLAM owns translation: the
 * visitor scans the floor QR ONCE, the placements pin to the world, and they
 * can walk around while the engine keeps everything locked.
 *
 * Three product requirements drive the design (spec §1–3):
 *
 *   1. Overlay layering — every UI element lives under ONE overlay root at
 *      `z-[10000]` over the engine canvas; interactive children opt back into
 *      pointer events so touch still reaches the engine (gestures). Nothing UI
 *      lives outside this root (the field bug where the HUD got painted under
 *      the engine canvas is the lesson).
 *   2. Continuous re-alignment — in `viewing`, the QR decode loop keeps running
 *      at ~2 fps. A trustworthy re-solve (`RealignGuard`) recomputes
 *      `T_slam←anchor` and snaps the SINGLE `anchorGroup` to it, wiping drift
 *      with a brief green "align pulse". A low-key 「重新對準」 button forces a
 *      return to `scanning`.
 *   3. Mode switch (AR ↔ 3D) — full teardown (XR8.stop / clear, constraint
 *      shim restore, three.js dispose) before navigating to /b.
 *
 * State machine (spec §2):
 *   permission-gate → slam-starting → scanning → viewing  (↺ re-align)
 *
 * Everything that touches the hot loop (SLAM pose, anchor group, guard) lives
 * in refs — the engine drives its own three.js loop outside React's render.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  TextureLoader,
  Vector3,
  type Matrix4,
  type Texture,
} from "three";

import { MOCK_QR_SIZE_MM } from "@/lib/ar/mock-placements";
import { solveSquarePose } from "@/lib/ar/ippe";
import { computeAlignment } from "@/lib/slam/alignment";
import { loadXR8, loadXRExtras } from "@/lib/slam/load-xr8";
import { decodeQrFromLuminance } from "@/lib/slam/qr-from-luminance";
import { RealignGuard } from "@/lib/slam/realign";

import { usePlacements, type RenderPlacement } from "../usePlacements";

/**
 * permission-gate — the mandatory Start tap (iOS camera/motion user gesture).
 * slam-starting — engine binary loading + camera coming up.
 * scanning      — QR loop at ~6fps, guiding the user to the floor QR.
 * viewing       — placements pinned; QR loop drops to ~2fps for continuous
 *                 re-alignment (spec §3).
 */
type Phase = "permission-gate" | "slam-starting" | "scanning" | "viewing";

type Hud = {
  /** Reproj error (px) of the last accepted alignment. */
  lastReprojPx: number | null;
  /** Last QR text seen (sanity — is it even our station?). */
  lastQrText: string | null;
  /** How many times we've (re-)aligned this session. */
  realignCount: number;
  lumOk: number;
  lumNull: number;
  capRes: string | null;
  cpuKeys: string | null;
};

const freshHud = (): Hud => ({
  lastReprojPx: null,
  lastQrText: null,
  realignCount: 0,
  lumOk: 0,
  lumNull: 0,
  capRes: null,
  cpuKeys: null,
});

/** Scanning decodes aggressively; viewing only needs low-frequency re-align. */
const SCAN_THROTTLE_MS = 160; // ~6fps
const VIEW_THROTTLE_MS = 500; // ~2fps (spec §3)
/** How long the green align-pulse shows after a successful snap (ms). */
const ALIGN_PULSE_MS = 200;

/** QR physical edge length (mm). TODO(api): read `AnchorOut.size_mm` once the
 *  anchor fetch is wired into this screen (mirrors ARView's TODO). */
const QR_SIZE_MM = MOCK_QR_SIZE_MM;

/** Coarse mobile check — SLAM + IMU only make sense on a phone/tablet. */
function isLikelyMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const touch =
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0);
  return /android|iphone|ipad|ipod|mobile/i.test(ua) && touch;
}

export default function ARViewSlam() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ stationId: string }>();

  const debugEnabled = useMemo(
    () =>
      import.meta.env.DEV ||
      new URLSearchParams(location.search).get("debug") === "1",
    [location.search],
  );

  const [phase, setPhase] = useState<Phase>("permission-gate");
  const [stationId, setStationId] = useState<string | undefined>(
    params.stationId,
  );
  const [mobile] = useState(isLikelyMobile);
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState<Hud>(freshHud);
  const [alignPulse, setAlignPulse] = useState(false);

  const { placements } = usePlacements(stationId);

  // ── Hot-loop refs (never touched by React's render) ───────────────────────
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);
  /** The pixel-array module's self-reported result key (rename-proof). */
  const cpaKeyRef = useRef<string | null>(null);
  /** Latest SLAM camera pose, written every frame, read at QR-solve instant. */
  const slamPoseRef = useRef<{ position: Vector3; quaternion: Quaternion } | null>(
    null,
  );
  /** Single group every placement is parented to: re-align snaps ITS matrix,
   *  never rebuilds the meshes (spec §3). */
  const anchorGroupRef = useRef<Group | null>(null);
  /** Textures we created, for dispose on teardown. */
  const texturesRef = useRef<Texture[]>([]);
  /** Whether the first alignment has happened (gates scanning→viewing). */
  const alignedRef = useRef(false);
  const lastQrAttemptRef = useRef(0);
  const realignGuardRef = useRef<RealignGuard>(new RealignGuard());
  const pulseTimerRef = useRef<number | null>(null);

  // Phase / station mirrors for the engine callbacks that outlive a render.
  const phaseRef = useRef<Phase>(phase);
  const stationIdRef = useRef<string | undefined>(stationId);
  const placementsRef = useRef<RenderPlacement[]>(placements);
  phaseRef.current = phase;
  stationIdRef.current = stationId;
  placementsRef.current = placements;

  // ── Teardown: every owned engine + three.js resource ──────────────────────
  const releaseAll = useCallback(() => {
    const XR8 = window.XR8;
    try {
      XR8?.stop();
      XR8?.clearCameraPipelineModules();
    } catch {
      // best-effort
    }
    // Detach + dispose the anchor group's meshes/geometries.
    const group = anchorGroupRef.current;
    if (group) {
      group.parent?.remove(group);
      group.traverse((obj) => {
        if (obj instanceof Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      anchorGroupRef.current = null;
    }
    for (const tex of texturesRef.current) tex.dispose();
    texturesRef.current = [];
    restoreConstraintShim();
    startedRef.current = false;
    alignedRef.current = false;
  }, []);

  // ── Snap the anchor group to a freshly-computed alignment (no rebuild) ─────
  const snapAnchorGroup = useCallback((alignment: Matrix4) => {
    const group = anchorGroupRef.current;
    if (!group) return;
    // The alignment T maps anchor-frame → SLAM world. Decompose onto the group
    // so every child placement (authored in the anchor frame) lands in world.
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    alignment.decompose(position, quaternion, scale);
    group.position.copy(position);
    group.quaternion.copy(quaternion);
    group.scale.copy(scale);
    group.updateMatrixWorld(true);
  }, []);

  // ── Build the anchor group once: meshes parented at their anchor-frame TRS,
  //    group itself snapped via snapAnchorGroup. Re-align only moves the group.
  const buildAnchorGroup = useCallback(
    (XR8: XR8Static) => {
      if (anchorGroupRef.current) return; // already built this session
      const { scene } = XR8.Threejs.xrScene();
      const group = new Group();
      const loader = new TextureLoader();
      const geometry = new PlaneGeometry(1, 1);

      for (const p of placementsRef.current) {
        const texture = loader.load(p.textureUrl);
        texture.colorSpace = "srgb";
        texturesRef.current.push(texture);
        const material = new MeshBasicMaterial({
          map: texture,
          side: DoubleSide,
          toneMapped: false,
          transparent: true,
        });
        const mesh = new Mesh(geometry, material);
        // Author each mesh at its anchor-frame transform; the GROUP carries the
        // anchor→world alignment, so children stay authored-space.
        mesh.position.set(...p.position);
        mesh.quaternion.set(...p.rotation);
        mesh.scale.set(...p.scale);
        group.add(mesh);
      }
      scene.add(group);
      anchorGroupRef.current = group;
    },
    [],
  );

  // ── Fire the 200ms green align-pulse feedback ─────────────────────────────
  const flashAlignPulse = useCallback(() => {
    if (!mountedRef.current) return;
    setAlignPulse(true);
    if (pulseTimerRef.current != null) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setAlignPulse(false);
    }, ALIGN_PULSE_MS);
  }, []);

  // ── A trustworthy QR solve: compute T, snap the group, advance state ───────
  const onSolve = useCallback(
    (
      detectedStation: string,
      reprojErrorPx: number,
      cameraInAnchor: { position: Vector3; quaternion: Quaternion },
    ) => {
      if (!slamPoseRef.current) return;

      // A different station's QR entered frame → re-anchor + swap stationId so
      // usePlacements refetches, and keep the URL honest (spec §2). The new
      // placements rebuild on the next aligned frame (clear the group).
      if (detectedStation !== stationIdRef.current) {
        releasePlacementsOnly();
        realignGuardRef.current.reset();
        alignedRef.current = false;
        setStationId(detectedStation);
        navigate(`/a/view/${detectedStation}`, { replace: true });
        // Don't align this frame — placements for the new station aren't built
        // yet; the next decoded frame (after the rebuild) will align.
        return;
      }

      const T = computeAlignment(cameraInAnchor, slamPoseRef.current);

      if (!alignedRef.current) {
        // First lock for this station: build the group, snap, enter viewing.
        const XR8 = window.XR8;
        if (XR8) buildAnchorGroup(XR8);
        snapAnchorGroup(T);
        alignedRef.current = true;
        realignGuardRef.current.seed(reprojErrorPx);
        flashAlignPulse();
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(50);
        }
        setHud((h) => ({
          ...h,
          lastReprojPx: reprojErrorPx,
          realignCount: h.realignCount + 1,
        }));
        if (mountedRef.current) setPhase("viewing");
        return;
      }

      // Continuous re-alignment in viewing: jitter-guarded snap (spec §3).
      const decision = realignGuardRef.current.offer(reprojErrorPx);
      if (!decision.accept) return;
      snapAnchorGroup(T);
      flashAlignPulse();
      setHud((h) => ({
        ...h,
        lastReprojPx: reprojErrorPx,
        realignCount: h.realignCount + 1,
      }));
    },
    [buildAnchorGroup, snapAnchorGroup, flashAlignPulse, navigate],
  );

  /** Detach + dispose just the placement meshes (station change), keeping the
   *  engine running. The next aligned frame rebuilds for the new station. */
  function releasePlacementsOnly(): void {
    const group = anchorGroupRef.current;
    if (group) {
      group.parent?.remove(group);
      group.traverse((obj) => {
        if (obj instanceof Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    }
    anchorGroupRef.current = null;
    for (const tex of texturesRef.current) tex.dispose();
    texturesRef.current = [];
  }

  // ── Start: load engine, build pipeline, run ───────────────────────────────
  const start = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setError(null);
    setPhase("slam-starting");

    // 4:3 full-sensor capture shim (field round 3): the engine only asks for
    // `min` constraints, letting iOS pick a 16:9 sensor-crop ("zoom"). Inject
    // the Mode A 4:3 recipe — same lens, full FOV — and restore on teardown.
    installConstraintShim();

    let XR8: XR8Static;
    let xrExtras: import("@/lib/slam/load-xr8").XRExtrasStatic;
    try {
      [XR8, xrExtras] = await Promise.all([loadXR8(), loadXRExtras()]);
    } catch (e) {
      startedRef.current = false;
      setPhase("permission-gate");
      setError(e instanceof Error ? e.message : "engine load failed");
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      startedRef.current = false;
      setPhase("permission-gate");
      setError("canvas missing");
      return;
    }

    const fusionModule: XR8CameraPipelineModule = {
      name: "tcsh-slam-fusion",
      onCameraStatusChange: ({ status }) => {
        if (status === "hasStream" || status === "hasVideo") {
          // Camera live → leave starting, guide the user to the QR.
          if (mountedRef.current && phaseRef.current === "slam-starting") {
            setPhase("scanning");
          }
        }
      },
      onException: (err) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
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
        }

        // Throttle QR decode: aggressive while scanning, low while viewing
        // (continuous re-align only — spec §3). Skip entirely on the gate.
        const ph = phaseRef.current;
        if (ph !== "scanning" && ph !== "viewing") return;
        const throttle = ph === "viewing" ? VIEW_THROTTLE_MS : SCAN_THROTTLE_MS;
        const now =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        if (now - lastQrAttemptRef.current < throttle) return;
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
          capRes: h.capRes ?? `${cam.width}×${cam.height}`,
        }));

        const detection = decodeQrFromLuminance(cam.data, cam.width, cam.height);
        if (!detection) return;
        setHud((h) => ({ ...h, lastQrText: detection.text }));
        if (detection.payload.kind !== "station" || !detection.corners) return;

        const solved = solveSquarePose(
          detection.corners,
          QR_SIZE_MM,
          cam.width,
          cam.height,
        );
        if (!solved) return;

        onSolve(
          detection.payload.stationId,
          solved.reprojErrorPx,
          { position: solved.position, quaternion: solved.quaternion },
        );
      },
    };

    try {
      const cpaModule = XR8.CameraPixelArray.pipelineModule({ luminance: true });
      cpaKeyRef.current = (cpaModule as { name?: string }).name ?? null;
      XR8.addCameraPipelineModules([
        // Official canvas management: fullscreen, aspect-true, rotation-aware.
        xrExtras.FullWindowCanvas.pipelineModule(),
        XR8.GlTextureRenderer.pipelineModule(), // camera feed
        XR8.Threejs.pipelineModule(), // three.js scene + camera
        XR8.XrController.pipelineModule(), // SLAM 6DoF
        cpaModule, // luminance frames for QR
        fusionModule,
      ]);
      XR8.run({ canvas });
    } catch (e) {
      startedRef.current = false;
      setPhase("permission-gate");
      setError(e instanceof Error ? e.message : "XR8.run failed");
    }
  }, [onSolve]);

  // ── Manual re-aim: drop back to scanning, clear the aligned flag ──────────
  const handleManualRealign = useCallback(() => {
    realignGuardRef.current.reset();
    alignedRef.current = false;
    if (mountedRef.current) setPhase("scanning");
  }, []);

  // ── Mode switch A → 3D: full teardown, then navigate ──────────────────────
  const switchToModeB = useCallback(() => {
    releaseAll();
    navigate("/b");
  }, [navigate, releaseAll]);

  // ── Lifecycle: unmount tears everything down ──────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pulseTimerRef.current != null) {
        window.clearTimeout(pulseTimerRef.current);
      }
      releaseAll();
    };
  }, [releaseAll]);

  const showGate = phase === "permission-gate";
  const reticleHint =
    phase === "viewing" ? "重新對準中…" : "對準地面的 QR";

  return (
    <main
      data-mode="a"
      data-screen="ar-view-slam"
      data-phase={phase}
      className="relative h-dvh w-screen overflow-hidden bg-black text-white"
    >
      {/* Engine canvas — XR8/FullWindowCanvas owns its sizing. Inline style
          wins the cascade against the engine's own inline writes (field bug:
          feed rendered as a top strip without this). */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />

      {/* ── SINGLE overlay root (spec §1). z-[10000] over the canvas; root is
          pointer-events-none so touch reaches the engine; each interactive
          child opts back in. Internal layering: gate 50 > toast 40 >
          switch 30 > reticle 20 > HUD 10. ─────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 z-[10000]">
        {/* Align-pulse: a brief green wash confirming a (re-)alignment snap. */}
        <div
          aria-hidden
          className={`absolute inset-0 z-[10] bg-emerald-400/10 ring-2 ring-inset ring-emerald-400/40 transition-opacity duration-200 ${
            alignPulse ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* HUD (z-10) — diagnostics, dev or ?debug=1 only. */}
        {debugEnabled && (
          <div className="safe-area pointer-events-none absolute inset-x-0 top-0 z-[10] flex items-start justify-between px-4 pt-4 text-xs">
            <div className="pointer-events-auto rounded bg-black/55 px-2 py-1 font-mono leading-5">
              <div>phase: {phase}</div>
              <div>station: {stationId ?? "—"}</div>
              <div>
                lum: ok={hud.lumOk} null={hud.lumNull}
              </div>
              {hud.capRes && <div>cap: {hud.capRes}</div>}
              <div>aligns: {hud.realignCount}</div>
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
              {hud.cpuKeys && (
                <div className="max-w-[60vw] truncate opacity-50">
                  keys: {hud.cpuKeys.slice(0, 60)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reticle (z-20) — subtle framing while scanning OR re-aligning. */}
        {(phase === "scanning" || phase === "viewing") && (
          <div className="pointer-events-none absolute inset-0 z-[20] flex items-center justify-center">
            <div
              className={`flex flex-col items-center gap-3 transition-opacity duration-300 ${
                phase === "scanning" ? "opacity-100" : "opacity-0"
              }`}
            >
              <div className="h-44 w-44 rounded-2xl border-2 border-white/70" />
              <p className="rounded-full bg-black/55 px-3 py-1 text-sm">
                {reticleHint}
              </p>
            </div>
          </div>
        )}

        {/* Mode switch + manual re-aim (z-30) — top bar, both interactive. */}
        {phase !== "permission-gate" && (
          <div className="safe-area pointer-events-none absolute inset-x-0 top-0 z-[30] flex items-start justify-between px-4 pt-4">
            {/* Manual re-aim: low-key, only meaningful once viewing. */}
            {phase === "viewing" ? (
              <button
                type="button"
                onClick={handleManualRealign}
                className="pointer-events-auto rounded-full bg-black/50 px-4 py-2 text-sm font-medium text-white/90 backdrop-blur"
                aria-label="重新對準 QR 校準位置"
              >
                重新對準
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={switchToModeB}
              className="pointer-events-auto rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur"
              aria-label="切換到 3D 檢視（Mode B）"
            >
              AR ｜ <span className="text-white/50">3D</span>
            </button>
          </div>
        )}

        {/* Starting toast (z-40). */}
        {phase === "slam-starting" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-10 z-[40] text-center text-sm text-white/80">
            啟動 SLAM 引擎…
          </div>
        )}

        {/* Permission / error gate (z-50). */}
        {(showGate || error) && (
          <div className="pointer-events-auto absolute inset-0 z-[50] flex flex-col items-center justify-center gap-4 bg-black/85 px-6 text-center">
            {!mobile ? (
              <>
                <p className="text-base font-semibold">請用手機開啟</p>
                <p className="max-w-xs text-sm text-white/70">
                  這個 AR 體驗需要手機的相機與動作感測器。桌機沒有 SLAM /
                  IMU，引擎無法追蹤。請用手機掃描地面的 QR 進入。
                </p>
              </>
            ) : (
              <>
                <p className="text-base font-semibold">準備好開始 AR 了嗎？</p>
                <p className="max-w-xs text-sm text-white/70">
                  對準地面的 QR，作品會釘在你眼前——走近會變大、走遠會變小。
                  需要相機與方位權限。
                </p>
              </>
            )}
            {error && (
              <p className="max-w-xs text-sm text-red-400">{error}</p>
            )}
            {mobile && (
              <button
                type="button"
                onClick={() => void start()}
                className="pointer-events-auto rounded-full bg-accent px-6 py-3 text-base font-semibold text-black"
              >
                {error ? "重試" : "開始 AR"}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * Pull a luminance frame out of the pipeline result. Engine ≥1.0 surfaces it in
 * `processGpuResult` under the module's own result key; older builds used
 * `processCpuResult.camerapixelarray`. Read defensively (field round 2).
 */
function readCameraLuminance(
  processCpuResult: XR8PipelineUpdateArgs["processCpuResult"],
  processGpuResult: XR8PipelineUpdateArgs["processGpuResult"],
  moduleKey: string | null,
): { data: Uint8Array; width: number; height: number } | null {
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

  const data =
    pixels instanceof Uint8Array
      ? pixels
      : Uint8Array.from(pixels as ArrayLike<number>);
  if (data.length < cols * rows) return null;
  return { data, width: cols, height: rows };
}

// ── getUserMedia 4:3 constraint shim ──────────────────────────────────────
// Augments the engine's video constraints with the Mode A full-sensor 4:3
// recipe while this screen is active (same lens, full FOV). Restored on
// teardown so other camera consumers see the untouched API.
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
