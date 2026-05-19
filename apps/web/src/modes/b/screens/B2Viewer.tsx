import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ArtworkModel } from "@/lib/3d/ArtworkModel";
import { ModelErrorBoundary } from "@/lib/3d/ModelErrorBoundary";

/**
 * B2 · 3D Viewer (issue #19).
 *
 * Fullbleed R3F canvas showing the artwork's glTF. Matches Figma 5:13 /
 * 5:55 — dark background, top chrome bar, bottom pill toolbar, first-visit
 * gesture overlay. B3 (#20 search) and B4 (#21 list) land as sub-routes
 * triggered from this toolbar.
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
  // Ready-flag wired into <ArtworkModel onReady />. Drives LoadingOverlay
  // visibility — without this the overlay had no path back to hidden and
  // stayed on top of the canvas forever once the 300ms delay elapsed.
  const [modelReady, setModelReady] = useState(false);

  // Router's lazy chunk + <ArtworkModel>'s own `useGLTF(URL)` already
  // trigger the fetch via Suspense before any effect runs here, so a
  // useEffect calling `useGLTF.preload` would be a no-op (the cache entry
  // exists by the time effects fire). Drop the dead preload effect.

  useEffect(() => {
    const seen = localStorage.getItem(GESTURE_HINTS_KEY) === "1";
    setHintsVisible(!seen);
  }, []);

  const handleModelReady = useCallback(() => {
    setModelReady(true);
  }, []);

  function dismissHints() {
    localStorage.setItem(GESTURE_HINTS_KEY, "1");
    setHintsVisible(false);
  }

  function handleBack() {
    if (window.history.length > 1) navigate(-1);
    else navigate("/", { replace: true });
  }

  function resetView() {
    // Remount ArtworkModel. Flip ready back to false so LoadingOverlay can
    // re-arm; the new mount's useLayoutEffect will call onReady again once
    // the camera-fit pass completes.
    setModelReady(false);
    setFitKey((n) => n + 1);
  }

  return (
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
              makeDefault
              enablePan={false}
              enableDamping
              dampingFactor={0.08}
              minDistance={0.01}
              maxDistance={10000}
            />
          </Canvas>
        </ModelErrorBoundary>

        {/* DOM-space loading fallback — the in-canvas Suspense renders
            nothing (a 3D spinner would flash inside the dark canvas
            before unmounting), so the "載入中…" text lives out here.
            Hides as soon as <ArtworkModel onReady> fires; the 300ms
            delay still suppresses the flash on fast loads. */}
        <LoadingOverlay ready={modelReady} />

        {hintsVisible && <GestureHints onDismiss={dismissHints} />}
      </div>

      <BottomToolbar onReset={resetView} />
    </main>
  );
}

const GESTURE_HINTS_KEY = "tcsh:mode-b:gesture-hints-seen";

// ── Loading overlay ───────────────────────────────────────────────────
function LoadingOverlay({ ready }: { ready: boolean }) {
  // Two gates: the 300ms `delayElapsed` suppresses a flash on fast
  // loads, and `ready` (driven by <ArtworkModel onReady>) is the exit
  // signal — once the model has framed itself we unmount, so the text
  // never sticks on top of the canvas.
  const [delayElapsed, setDelayElapsed] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setDelayElapsed(true), 300);
    return () => window.clearTimeout(t);
  }, []);
  if (ready || !delayElapsed) return null;
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
        data-testid="mode-b-back"
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
        <ToolbarButton label="重置" icon="↻" onClick={onReset} testId="mode-b-reset" />
        <ToolbarButton label="搜尋" icon="🔍" onClick={onSearch} testId="mode-b-search" />
        <ToolbarButton label="列表" icon="☰" onClick={onList} testId="mode-b-list" />
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
  /** Stable hook for Playwright / e2e selectors. */
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
      data-testid="mode-b-gesture-hints"
      className="safe-area absolute inset-0 z-20 flex flex-col items-center justify-center gap-10 bg-black/60 backdrop-blur-[2px]"
    >
      <HintRow icons="👆 👆" label="雙指縮放" />
      <HintRow icons="👆" label="單指旋轉" />
      <button
        ref={confirmRef}
        type="button"
        onClick={onDismiss}
        data-testid="mode-b-gesture-dismiss"
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
