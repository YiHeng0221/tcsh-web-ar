import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { ArtworkModel } from "@/lib/3d/ArtworkModel";

/**
 * B2 · 3D Viewer (issue #19).
 *
 * Fullbleed R3F canvas showing the artwork's glTF. Matches Figma 5:13 /
 * 5:55 — dark background, top chrome bar, bottom pill toolbar, first-visit
 * gesture overlay. B3 (#20 search) and B4 (#21 list) land as sub-routes
 * triggered from this toolbar.
 */
export default function B2Viewer() {
  const navigate = useNavigate();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const [hintsVisible, setHintsVisible] = useState(false);

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

  function resetView() {
    controlsRef.current?.reset();
  }

  return (
    <main
      data-mode="b"
      data-screen="b2"
      className="relative flex h-dvh w-screen flex-col overflow-hidden bg-bg text-fg"
    >
      <TopBar onBack={handleBack} />

      <div className="relative flex-1">
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 0.8, 3.5], fov: 42, near: 0.1, far: 50 }}
          gl={{ antialias: true }}
          className="h-full w-full"
        >
          <color attach="background" args={["#0a0a0a"]} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[4, 6, 4]} intensity={0.9} />
          <directionalLight position={[-4, 2, -4]} intensity={0.3} />

          <Suspense fallback={null}>
            <ArtworkModel />
          </Suspense>

          <OrbitControls
            ref={controlsRef}
            enablePan={false}
            enableDamping
            dampingFactor={0.08}
            minDistance={1.2}
            maxDistance={8}
          />
        </Canvas>

        {hintsVisible && <GestureHints onDismiss={dismissHints} />}
      </div>

      <BottomToolbar onReset={resetView} onSearch={() => {}} onList={() => {}} />
    </main>
  );
}

const GESTURE_HINTS_KEY = "tcsh:mode-b:gesture-hints-seen";

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
  onSearch: () => void;
  onList: () => void;
}) {
  return (
    <nav
      aria-label="檢視器工具列"
      className="safe-area pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-6"
    >
      <div className="pointer-events-auto flex h-14 w-[280px] items-center justify-around rounded-full border border-white/10 bg-white/10 text-fg backdrop-blur-md">
        <ToolbarButton label="重置" icon="↻" onClick={onReset} />
        <ToolbarButton label="搜尋" icon="🔍" onClick={onSearch} disabled />
        <ToolbarButton label="列表" icon="☰" onClick={onList} disabled />
      </div>
    </nav>
  );
}

function ToolbarButton({
  label,
  icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-full w-[92px] flex-col items-center justify-center gap-0.5 disabled:opacity-40"
      aria-label={label}
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
