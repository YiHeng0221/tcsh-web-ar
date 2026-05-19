import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import type { ARObject } from "@/lib/api";
import { ArtworkModel, preloadArtwork } from "@/lib/3d/ArtworkModel";
import { ModelErrorBoundary } from "@/lib/3d/ModelErrorBoundary";
import {
  ViewerContext,
  type ViewerController,
} from "@/modes/b/components/ViewerContext";

// B3 / B4 are heavy-ish (TanStack Query + their own subtree) and only
// open on demand from the toolbar — code-split so the canvas first paint
// isn't blocked behind their bundle. Inside an already-lazy route, this
// is a second-tier split: still cheaper than eager-loading two screens
// the user might never open.
const B3Search = lazy(() => import("@/modes/b/screens/B3Search"));
const B4List = lazy(() => import("@/modes/b/screens/B4List"));

/**
 * B2 · 3D Viewer (issue #19).
 *
 * Fullbleed R3F canvas showing the artwork's glTF. Matches Figma 5:13 /
 * 5:55 — dark background, top chrome bar, bottom pill toolbar, first-visit
 * gesture overlay. B3 (#20 search) and B4 (#21 list) mount as overlays
 * over this screen (sheet on mobile / portrait, side panel on landscape)
 * and use a `ViewerController` context to fly the camera to a chosen
 * object.
 *
 * Camera framing lives inside ArtworkModel (`src/lib/3d/`): the model
 * owns its own recentre + zoom-to-fit so any caller just drops it in.
 */
export default function B2Viewer() {
  const navigate = useNavigate();
  const [hintsVisible, setHintsVisible] = useState(false);
  // Bumping this key remounts ArtworkModel, which re-runs its recentre +
  // camera-fit effect. Cheaper than threading a framing API through props.
  const [fitKey, setFitKey] = useState(0);
  // Set true the first time ArtworkModel's onReady fires; stays true
  // across resetView bumps because the glTF is already cached by drei,
  // so the remount is near-instant and flashing "載入中…" back on would
  // be misleading.
  const [modelReady, setModelReady] = useState(false);
  // Which overlay (if any) sits on top of the canvas. Mutually exclusive
  // — opening one closes the other.
  const [overlay, setOverlay] = useState<"search" | "list" | null>(null);

  // Imperative handle into the canvas' OrbitControls + camera, populated
  // by <CanvasBridge /> below. Refs (not state) so updating them doesn't
  // re-render the controller object identity, which would re-fire any
  // memoised consumers downstream.
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const flyTargetRef = useRef<Vector3 | null>(null);

  useEffect(() => {
    // Preload only when the viewer actually mounts. Module-level preload
    // would download ~10 MB every time any Mode A / landing route opens
    // because router's code-split chunk pre-parses imports.
    preloadArtwork();
  }, []);

  useEffect(() => {
    const seen = localStorage.getItem(GESTURE_HINTS_KEY) === "1";
    setHintsVisible(!seen);
  }, []);

  function dismissHints() {
    localStorage.setItem(GESTURE_HINTS_KEY, "1");
    setHintsVisible(false);
  }

  function handleBack() {
    if (window.history.length > 1) navigate(-1);
    else navigate("/", { replace: true });
  }

  // Independent counter so flyToObject can re-trigger CanvasBridge without
  // bumping `fitKey` (which is ArtworkModel's React key — bumping it would
  // unmount the glTF, dispose its GPU resources, and re-clone the scene on
  // every fly-to). See PR #62 AI review (MAJOR #2).
  const [flyVersion, setFlyVersion] = useState(0);

  const resetView = useCallback(() => {
    flyTargetRef.current = null;
    setFitKey((n) => n + 1);
  }, []);

  // Fly-to behaviour. Placement-based world coordinates require backend
  // `/placements` to populate `transform.position`, which lands with Mode C.
  // Until then `flyToObject` is a no-op: the original PR computed a fake
  // hash-derived position on the client, which violated frontend.md "No
  // placement math on client — API is source of truth" and would have
  // shipped misleading "moving camera" feedback that didn't match real
  // object locations. See PR #62 AI review (MAJOR #3).
  const flyToObject = useCallback((_object: ARObject) => {
    // Reserved for the placement-driven lookup. Returning early keeps the
    // overlay's selection flow (close-on-pick) working without lying about
    // camera position. Once placements arrive, set `flyTargetRef.current`
    // from `placement.transform.position` and bump `setFlyVersion`.
    flyTargetRef.current = null;
    setFlyVersion((n) => n + 1);
  }, []);

  // Stable handler so ArtworkModel's framing effect doesn't re-fire on
  // unrelated B2Viewer renders (e.g. opening an overlay). See PR #62 AI
  // review (MAJOR #1).
  const handleModelReady = useCallback(() => setModelReady(true), []);

  // Stable controller identity so context consumers don't re-render on
  // unrelated state changes (e.g. opening / closing the overlay).
  const controller = useMemo<ViewerController>(
    () => ({ flyToObject, resetView }),
    [flyToObject, resetView],
  );

  return (
    <ViewerContext value={controller}>
      <main
        data-mode="b"
        data-screen="b2"
        className="relative flex h-dvh w-screen flex-col overflow-hidden bg-bg text-fg"
      >
        <TopBar onBack={handleBack} />

        <div className="relative flex-1">
          <ModelErrorBoundary onRetry={resetView}>
            <Canvas
              dpr={[1, 2]}
              // fov 40 reads comfortably for artwork presentation. Camera
              // position is overridden by ArtworkModel after glTF load.
              camera={{ fov: 40, near: 0.01, far: 10000 }}
              gl={{ antialias: true }}
              className="h-full w-full"
            >
              <color attach="background" args={["#0a0a0a"]} />
              <ambientLight intensity={0.6} />
              <directionalLight position={[4, 6, 4]} intensity={0.9} />
              <directionalLight position={[-4, 2, -4]} intensity={0.3} />

              <Suspense fallback={null}>
                <ArtworkModel key={fitKey} onReady={handleModelReady} />
              </Suspense>

              {/* Distance bounds wide open — ArtworkModel sets the right
                  initial distance; visitors decide how far to push. */}
              <OrbitControls
                ref={controlsRef}
                makeDefault
                enablePan={false}
                enableDamping
                dampingFactor={0.08}
                minDistance={0.01}
                maxDistance={10000}
              />

              <CanvasBridge flyTargetRef={flyTargetRef} flyVersion={flyVersion} />
            </Canvas>
          </ModelErrorBoundary>

          {/* DOM-space loading fallback — the in-canvas Suspense renders
              nothing (a 3D spinner would flash inside the dark canvas
              before unmounting), so the "載入中…" text lives out here and
              hides itself once ArtworkModel fires onReady. */}
          <LoadingOverlay loaded={modelReady} />

          {hintsVisible && <GestureHints onDismiss={dismissHints} />}

          {/* Overlay layer: B3 / B4 are absolutely positioned siblings of
              the canvas, so they cover the whole viewer area but leave
              the top bar / bottom toolbar visible behind them only on
              tablet-landscape (where they dock to the right). */}
          {overlay !== null && (
            <Suspense fallback={null}>
              {overlay === "search" ? (
                <B3Search onClose={() => setOverlay(null)} />
              ) : (
                <B4List onClose={() => setOverlay(null)} />
              )}
            </Suspense>
          )}
        </div>

        <BottomToolbar
          onReset={resetView}
          onSearch={() => setOverlay("search")}
          onList={() => setOverlay("list")}
        />
      </main>
    </ViewerContext>
  );
}

const GESTURE_HINTS_KEY = "tcsh:mode-b:gesture-hints-seen";

// ── Canvas-side bridge ────────────────────────────────────────────────
/**
 * Lives inside the R3F Canvas so it has direct access to `useThree` —
 * lets us imperatively update OrbitControls' target when a B3 / B4 row
 * fires `flyToObject`. Refs (not state) flow in because we don't want
 * a re-render every time the target updates; OrbitControls reads its
 * own target each frame.
 */
function CanvasBridge({
  flyTargetRef,
  flyVersion,
}: {
  flyTargetRef: React.RefObject<Vector3 | null>;
  flyVersion: number;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;

  useEffect(() => {
    const target = flyTargetRef.current;
    if (!controls || !target) return;
    // Move the orbit pivot to the requested point and pull the camera
    // off-axis so the framing change is visible. We keep the user's
    // current camera distance — feels less jarring than yanking them
    // close, and they can still pinch to zoom.
    const offset = new Vector3()
      .copy(camera.position)
      .sub(controls.target);
    const distance = offset.length() || 1;
    // Damp distance to a sensible range so a flyTo with the camera
    // already pulled way out doesn't leave the object as a speck.
    const desired = Math.min(Math.max(distance, 1), 6);
    offset.normalize().multiplyScalar(desired);

    controls.target.copy(target);
    camera.position.copy(target).add(offset);
    camera.updateProjectionMatrix();
    controls.update();
    // Single-shot — clear the request so a later resetView doesn't
    // re-apply this target.
    flyTargetRef.current = null;
  }, [flyVersion, camera, controls, flyTargetRef]);

  return null;
}

// ── Loading overlay ───────────────────────────────────────────────────
function LoadingOverlay({ loaded }: { loaded: boolean }) {
  // Gate the 300 ms appearance delay so a fast load doesn't flash "載入中…"
  // on screen. Once `loaded` flips true we stop showing entirely — even if
  // the delay hadn't yet fired.
  const [delayElapsed, setDelayElapsed] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setDelayElapsed(true), 300);
    return () => window.clearTimeout(t);
  }, []);
  if (loaded || !delayElapsed) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center text-sm text-muted"
    >
      載入中…
    </div>
  );
}

// ── Top bar ────────────────────────────────────────────────────────────
function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <header className="safe-area absolute inset-x-0 top-0 z-10 flex h-[92px] items-end justify-between bg-gradient-to-b from-black/80 to-transparent px-3 pb-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="返回"
        className="flex h-10 w-10 items-center justify-center text-[22px] leading-none text-fg"
      >
        ‹
      </button>
      <h1 className="text-sm font-medium">3D 檢視</h1>
      <button
        type="button"
        aria-label="更多選項"
        disabled
        className="flex h-10 w-10 items-center justify-center text-xl leading-none text-fg disabled:opacity-40"
      >
        ⋮
      </button>
    </header>
  );
}

// ── Bottom pill toolbar ────────────────────────────────────────────────
function BottomToolbar({
  onReset,
  onSearch,
  onList,
}: {
  onReset: () => void;
  onSearch?: () => void;
  onList?: () => void;
}) {
  return (
    <nav
      aria-label="檢視器工具列"
      className="safe-area pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-6"
    >
      <div className="pointer-events-auto flex h-14 w-[280px] items-center justify-around rounded-full border border-white/10 bg-white/10 text-fg backdrop-blur-md">
        <ToolbarButton label="重置" icon="↻" onClick={onReset} testId="mode-b-toolbar-reset" />
        <ToolbarButton label="搜尋" icon="🔍" onClick={onSearch} testId="mode-b-toolbar-search" />
        <ToolbarButton label="列表" icon="☰" onClick={onList} testId="mode-b-toolbar-list" />
      </div>
    </nav>
  );
}

function ToolbarButton({
  label,
  icon,
  onClick,
  testId,
}: {
  label: string;
  icon: string;
  /** Omit to disable the button (useful for B3/B4 placeholders). */
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex h-full w-[92px] flex-col items-center justify-center gap-0.5 disabled:opacity-40"
      aria-label={label}
      data-testid={testId}
    >
      <span className="text-lg leading-none" aria-hidden>
        {icon}
      </span>
      <span className="text-[10px] leading-none text-fg/70">{label}</span>
    </button>
  );
}

// ── First-visit gesture hints ──────────────────────────────────────────
function GestureHints({ onDismiss }: { onDismiss: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Move focus to the dismiss button on open so keyboard / screen-reader
  // users don't land on the surrounding page chrome, and listen for
  // Escape / Tab so the dialog contract holds. Focus is trapped on the
  // single button (it's the only focusable child), so we just redirect
  // any Tab attempts back to it.
  useEffect(() => {
    confirmRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      } else if (e.key === "Tab") {
        e.preventDefault();
        confirmRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="操作提示"
      className="safe-area absolute inset-0 z-20 flex flex-col items-center justify-center gap-10 bg-black/60 backdrop-blur-[2px]"
    >
      <HintRow icons="👆 👆" label="雙指縮放" />
      <HintRow icons="👆" label="單指旋轉" />
      <button
        ref={confirmRef}
        type="button"
        onClick={onDismiss}
        className="rounded-full border border-white/30 bg-white/10 px-8 py-2 text-sm text-white backdrop-blur-md"
      >
        知道了
      </button>
    </div>
  );
}

function HintRow({ icons, label }: { icons: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-3xl leading-none" aria-hidden>
        {icons}
      </p>
      <p className="text-sm font-medium text-white">{label}</p>
    </div>
  );
}
