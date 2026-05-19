import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Camera, Mesh, MeshStandardMaterial, Object3D, Vector3 } from "three";
import {
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Raycaster,
  Texture as ThreeTexture,
  TextureLoader,
  Vector2,
} from "three";

import { ArtworkModel, queueArtworkPreload } from "@/lib/3d/ArtworkModel";
import { ModelErrorBoundary } from "@/lib/3d/ModelErrorBoundary";
import type { Placement, Vec3 } from "@/lib/api";

import type { Texture as TextureRecord } from "../lib/textureApi";
import { textureUrl } from "../lib/textureApi";
import { TEXTURE_DRAG_MIME } from "./TexturePalette";

/**
 * Right-handed, anchor-relative cube that visualises a single placement
 * inside the editor canvas. The cube uses the placement's `transform`
 * (position + scale) as its world transform; rotation is left to identity
 * because the C5 form doesn't expose euler / quaternion editing yet.
 *
 * The selected placement gets an emissive cyan tint plus an edge outline
 * so the admin can visually confirm what the right-side form is editing.
 *
 * Click handling lives on the cube so R3F's raycaster delivers each hit
 * straight to `onSelect` without the editor needing a separate raycaster.
 */
type PlacementMarkerProps = {
  placement: Placement;
  /** Optional override applied while the form is dirty. Lets the canvas
   *  reflect unsaved edits without round-tripping through the server. */
  override?: Partial<{ position: Vec3; scale: Vec3; texture: TextureRecord }>;
  selected: boolean;
  /** This marker is the current drop target during a texture drag — render
   *  an extra highlight so the admin knows which one will accept the drop. */
  dropHovered: boolean;
  onSelect: (placementId: string) => void;
};

/** Custom marker name so the raycaster can filter to placement meshes only
 *  (the artwork glTF + studio floor would otherwise win some hits). */
const PLACEMENT_MESH_NAME = "tcsh-placement-marker";
const PLACEMENT_ID_USERDATA_KEY = "placementId";

const TEXTURE_LOADER = new TextureLoader();

function PlacementMarker({
  placement,
  override,
  selected,
  dropHovered,
  onSelect,
}: PlacementMarkerProps) {
  // Resolve the live (override) transform so dragging form sliders updates
  // the cube without waiting for a save round-trip.
  const position = override?.position ?? placement.transform.position;
  const scale = override?.scale ?? placement.transform.scale;

  // Lazy-load the texture image as a Three texture. We don't go through
  // drei's `useTexture` here because (a) the URL might be missing
  // (placement with no texture yet) and (b) we want a graceful fallback to
  // a flat colour, not a Suspense throw that crashes the canvas.
  //
  // Lifecycle: every time the texture record id changes we load a fresh
  // ThreeTexture and dispose the previous one on cleanup. Without the
  // explicit dispose the GPU would leak one texture per selection switch
  // (CLAUDE.md "Dispose geometry/material/texture on unmount — else GPU
  // leak"). `useState` instead of `useMemo` because we need the latest
  // value to survive cleanup of stale loads.
  const textureRecord = override?.texture ?? null;
  const textureRecordId = textureRecord?.id ?? null;
  const [textureImage, setTextureImage] = useState<ThreeTexture | null>(null);
  useEffect(() => {
    if (!textureRecord) {
      setTextureImage(null);
      return;
    }
    let cancelled = false;
    const tex = TEXTURE_LOADER.load(textureUrl(textureRecord));
    tex.flipY = false;
    if (!cancelled) setTextureImage(tex);
    return () => {
      cancelled = true;
      tex.dispose();
    };
    // We only care about the texture identity, not the record reference —
    // a parent re-render that hands us the same record by value should
    // not retrigger a fetch/dispose cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textureRecordId]);

  // A flat unlit-feeling material so admins read the texture's true colour
  // rather than the studio lighting. Emissive cyan on selection is kept
  // subtle — the edge outline does most of the "this is selected" work.
  const baseColor = selected ? "#00e5ff" : "#c97a48";

  // Drop-hover wins over selection for emissive feedback so the designer
  // sees a strong "drop here" cue even on the already-selected marker.
  const emissiveColor = dropHovered
    ? "#34d399"
    : selected
      ? "#00e5ff"
      : "#000000";
  const emissiveIntensity = dropHovered ? 0.7 : selected ? 0.35 : 0;

  return (
    <group
      position={[position.x, position.y, position.z]}
      scale={[Math.max(scale.x, 0.001), Math.max(scale.y, 0.001), Math.max(scale.z, 0.001)]}
      onPointerDown={(e) => {
        // stopPropagation so a click on the front face doesn't also trigger
        // the back face / OrbitControls' own pointer handler.
        e.stopPropagation();
        onSelect(placement.id);
      }}
    >
      <mesh
        castShadow
        receiveShadow
        // Tag the mesh so the drag-and-drop raycaster (in DragDropOverlay)
        // can filter only on placement markers, ignoring the floor / glTF.
        name={PLACEMENT_MESH_NAME}
        userData={{ [PLACEMENT_ID_USERDATA_KEY]: placement.id }}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={textureImage ? "#ffffff" : baseColor}
          map={textureImage}
          emissive={emissiveColor}
          emissiveIntensity={emissiveIntensity}
          side={DoubleSide}
          metalness={0.05}
          roughness={0.9}
        />
      </mesh>

      {(selected || dropHovered) && (
        <PlacementOutline color={dropHovered ? "#34d399" : "#00e5ff"} />
      )}
      {selected && (
        <Html
          position={[0.6, 0.6, 0]}
          className="pointer-events-none select-none whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-accent"
          center={false}
        >
          {placement.id.slice(0, 8)}
        </Html>
      )}
    </group>
  );
}

/**
 * Cyan wireframe outline drawn around the unit-cube placement marker. We
 * build it by hand (rather than `<Edges>` from drei) so the line material
 * stays opaque on top of the textured face — `<Edges>` overlays as a
 * regular line segment and z-fights when a texture is applied.
 */
function PlacementOutline({ color = "#00e5ff" }: { color?: string }) {
  const lines = useMemo(() => {
    const geom = new EdgesGeometry(new BoxGeometry(1.001, 1.001, 1.001));
    const mat = new LineBasicMaterial({ color });
    return new LineSegments(geom, mat);
  }, [color]);
  // Dispose handcrafted GPU resources on unmount (ArtworkModel sets the
  // precedent for treating per-mount three resources as ours to dispose).
  useEffect(() => {
    return () => {
      lines.geometry.dispose();
      (lines.material as LineBasicMaterial).dispose();
    };
  }, [lines]);
  return <primitive object={lines} />;
}

/** Custom name so DimmingPass can opt out of mutating the floor mesh. */
const STUDIO_FLOOR_NAME = "tcsh-studio-floor";

/**
 * Lazily build the 1024×1024 floor texture exactly once per page session.
 * Promoting it to a module-level singleton means every C5 entry/exit pair
 * reuses the same GPU texture — no per-mount CanvasTexture leak, no
 * regen cost on remount. Lazy because the module may load in a context
 * where `document` isn't available (tests, SSR), and we'd rather no-op
 * than crash importing.
 */
let cachedStudioFloorTexture: CanvasTexture | null = null;
function getStudioFloorTexture(): CanvasTexture | null {
  if (cachedStudioFloorTexture) return cachedStudioFloorTexture;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 16; i++) {
    const p = (i / 16) * 1024;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, 1024);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(1024, p);
    ctx.stroke();
  }
  cachedStudioFloorTexture = new CanvasTexture(c);
  return cachedStudioFloorTexture;
}

/**
 * Floor grid drawn beneath the artwork — gives admins a sense of scale
 * when the artwork glTF hasn't loaded yet (or when we're previewing in a
 * test build with no model). The 1024×1024 CanvasTexture is built once
 * at module level (`getStudioFloorTexture`), so admin in/out of C5
 * doesn't accumulate GPU resources.
 */
function StudioFloor() {
  const texture = useMemo(() => getStudioFloorTexture(), []);
  return (
    <mesh
      name={STUDIO_FLOOR_NAME}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -1.2, 0]}
      receiveShadow
    >
      <planeGeometry args={[20, 20]} />
      <meshStandardMaterial
        color="#0a0a0a"
        map={texture}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}

/**
 * Camera initialiser — positions the orbit camera the first time the
 * scene mounts so the artwork plus markers fit in the 920×664 viewport.
 * After that we hand control to OrbitControls; we don't want to fight
 * the user's drags on every render.
 */
function CameraSetup() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as
    | { target: Vector3; update: () => void }
    | null;
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    camera.position.set(3.2, 2.4, 4.6);
    camera.lookAt(0, 0.5, 0);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.set(0, 0.5, 0);
      controls.update();
    }
  }, [camera, controls]);
  return null;
}

export type CanvasPlacementSceneProps = {
  placements: Placement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Live overrides for the currently selected placement, mirroring the
   *  side-panel form so canvas + form stay in lockstep while the form is
   *  dirty. */
  selectedOverride?: PlacementMarkerProps["override"];
  /** Resolved texture record for the selected placement (so the marker can
   *  show the live texture pick instead of the saved one). */
  selectedTexture?: TextureRecord | null;
  /** Fired when a texture is dropped on a placement marker. The callback
   *  owns the form state + persistence (auto-save in C5). Empty space drops
   *  are no-ops; this fires only on a successful raycaster hit. */
  onTextureDrop?: (placementId: string, textureId: string) => void;
  /** Optional className for sizing — the editor sets `h-[664px] w-[920px]`. */
  className?: string;
  /** Slot rendered above the R3F canvas (still inside the relative wrapper)
   *  so floating overlays like the texture palette can sit on top of the
   *  3D view without the canvas swallowing pointer events. */
  overlay?: React.ReactNode;
};

/**
 * Snapshot of the live R3F scene refs (camera + scene root) lifted out of
 * `<Canvas>` so the outer drop handler can run a Three Raycaster against
 * them. We can't read these from inside the Canvas children at drop time
 * because dragover/drop events fire on the wrapping <div>, not on the R3F
 * event system (which only proxies pointer events).
 */
type SceneRefs = { camera: Camera; scene: Object3D } | null;

/**
 * The 920×664 R3F canvas at the heart of C5. Renders the artwork as a
 * faded backdrop, then a cube per placement (sized + positioned by its
 * `transform`). Click a cube → the parent updates `selectedId` and the
 * sidebar form fills in. Form edits flow back via `selectedOverride` so
 * the live cube tracks the form before save.
 *
 * The outer wrapping `<div>` doubles as the HTML5 drop target — a designer
 * can drag a texture out of `TexturePalette` (or the sidebar's 80×80
 * thumb) and drop it directly on a marker. We do raycasting in the wrapper
 * (HTML world) rather than via R3F pointer events because the drag
 * lifecycle's `dragover` / `drop` are HTML5 native events and don't reach
 * the R3F event system.
 */
export function CanvasPlacementScene({
  placements,
  selectedId,
  onSelect,
  selectedOverride,
  selectedTexture,
  onTextureDrop,
  className,
  overlay,
}: CanvasPlacementSceneProps) {
  useEffect(() => {
    // Same pattern as B2Viewer — keep the ~10 MB glTF preload off the
    // module top level so importing this file doesn't blow up bundles
    // that don't actually mount the editor.
    queueArtworkPreload();
  }, []);

  // The drop wrapper needs DOM access to compute NDC coordinates from the
  // pointer position. Held alongside live R3F scene refs harvested from
  // inside the Canvas.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const sceneRefsRef = useRef<SceneRefs>(null);
  const raycasterRef = useRef<Raycaster | null>(null);
  const ndcRef = useRef<Vector2 | null>(null);

  // Lazy-init Three helpers so the module import stays cheap. The Raycaster
  // and Vector2 are reused across drag events (no per-frame allocation).
  function getRaycaster(): Raycaster {
    if (!raycasterRef.current) raycasterRef.current = new Raycaster();
    return raycasterRef.current;
  }
  function getNdc(): Vector2 {
    if (!ndcRef.current) ndcRef.current = new Vector2();
    return ndcRef.current;
  }

  // The id of the placement currently being hovered during a drag, used to
  // light up the right marker. Reset on dragleave + drop.
  const [dropHoverId, setDropHoverId] = useState<string | null>(null);

  /**
   * Run a raycast against the marker meshes for a given pointer event and
   * return the topmost placement id. Returns `null` if the cursor is over
   * empty space, the artwork, or the floor — drops there should no-op.
   */
  const pickPlacementAt = useCallback(
    (clientX: number, clientY: number): string | null => {
      const wrapper = wrapperRef.current;
      const refs = sceneRefsRef.current;
      if (!wrapper || !refs) return null;

      const rect = wrapper.getBoundingClientRect();
      // NDC: x in [-1, 1] left→right, y in [-1, 1] bottom→top.
      const ndc = getNdc();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
      // If the pointer escaped the wrapper between events, bail.
      if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1) return null;

      const raycaster = getRaycaster();
      raycaster.setFromCamera(ndc, refs.camera);
      const intersects = raycaster.intersectObjects(refs.scene.children, true);
      // Filter to placement-marker meshes and pick the closest. The list is
      // already sorted by distance, so the first match wins.
      for (const hit of intersects) {
        const obj = hit.object as Mesh;
        if (obj.name !== PLACEMENT_MESH_NAME) continue;
        const id = obj.userData?.[PLACEMENT_ID_USERDATA_KEY];
        if (typeof id === "string") return id;
      }
      return null;
    },
    [],
  );

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    // Without a preventDefault on dragover the browser refuses to fire a
    // subsequent drop. We only opt in when a texture is being dragged so
    // unrelated drags (e.g. files into the page) keep their default UI.
    if (!isTextureDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const hitId = pickPlacementAt(e.clientX, e.clientY);
    setDropHoverId((prev) => (prev === hitId ? prev : hitId));
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Browsers fire dragleave on every child boundary; only clear when the
    // cursor truly left the wrapper.
    const next = e.relatedTarget as Node | null;
    if (next && wrapperRef.current?.contains(next)) return;
    setDropHoverId(null);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!isTextureDrag(e)) return;
    e.preventDefault();
    const textureId = e.dataTransfer.getData(TEXTURE_DRAG_MIME);
    setDropHoverId(null);
    if (!textureId) return;
    const hitId = pickPlacementAt(e.clientX, e.clientY);
    if (!hitId || !onTextureDrop) return;
    onTextureDrop(hitId, textureId);
  }

  return (
    <div
      ref={wrapperRef}
      className={`relative ${className ?? ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ModelErrorBoundary>
        <Canvas
          dpr={[1, 2]}
          camera={{ fov: 40, near: 0.01, far: 10000, position: [3.2, 2.4, 4.6] }}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          className="h-full w-full"
        >
          <color attach="background" args={["#0a0a0a"]} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[4, 6, 4]} intensity={0.8} castShadow />
          <directionalLight position={[-4, 3, -3]} intensity={0.25} />

          <CameraSetup />
          <SceneRefBridge sceneRefsRef={sceneRefsRef} />

          <Suspense fallback={null}>
            <group>
              <ArtworkModelDimmed />
            </group>
          </Suspense>

          <StudioFloor />

          {placements.map((p) => {
            const isSelected = p.id === selectedId;
            return (
              <PlacementMarker
                key={p.id}
                placement={p}
                selected={isSelected}
                dropHovered={p.id === dropHoverId}
                onSelect={onSelect}
                override={
                  isSelected
                    ? {
                        ...selectedOverride,
                        texture: selectedTexture ?? undefined,
                      }
                    : undefined
                }
              />
            );
          })}

          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.08}
            minDistance={1}
            maxDistance={50}
          />
        </Canvas>
      </ModelErrorBoundary>
      {overlay}
    </div>
  );
}

/** Returns true if the dragged payload is one of our texture drags — keeps
 *  unrelated drags (browser file drops, text selections) from triggering
 *  the drop visual or stealing default UI. */
function isTextureDrag(e: React.DragEvent<HTMLElement>): boolean {
  // `types` is a DOMStringList in some browsers; iteration is safer than
  // contains() which Safari/Firefox have shipped at different times.
  for (const t of e.dataTransfer.types) {
    if (t === TEXTURE_DRAG_MIME) return true;
  }
  return false;
}

/**
 * Tiny child of `<Canvas>` whose only job is to copy the live camera +
 * scene refs into a parent ref so the wrapping `<div>`'s drop handlers can
 * run a raycaster outside the R3F event system.
 */
function SceneRefBridge({
  sceneRefsRef,
}: {
  sceneRefsRef: React.MutableRefObject<SceneRefs>;
}) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    sceneRefsRef.current = { camera, scene };
    return () => {
      sceneRefsRef.current = null;
    };
  }, [camera, scene, sceneRefsRef]);
  return null;
}

/**
 * Wraps `ArtworkModel` with a translucent override material so the
 * artwork reads as scaffolding behind the placement cubes rather than
 * fighting them for attention. The model component already deep-clones
 * its meshes, so adjusting `material.opacity` here doesn't bleed back to
 * other Mode B / Mode A mounts that share the drei cache.
 *
 * If `ArtworkModel`'s fitting effect re-runs and re-frames the camera we
 * counter it inside CameraSetup; the user's orbit state stays put because
 * we only set the camera once on mount.
 */
function ArtworkModelDimmed() {
  // Wrap in a try-friendly Suspense fallback by rendering null when the
  // glTF errors — ModelErrorBoundary above catches the throw, so the rest
  // of the editor (markers, controls) keeps working.
  return (
    <group renderOrder={-1}>
      <ArtworkModel framing={2.4} />
      <DimmingPass />
    </group>
  );
}

/**
 * Wraps the artwork's children in a translucent grey on the next frame.
 * We can't reach into ArtworkModel's cloned scene from props, so we walk
 * `useThree(s => s.scene)` once after mount and tweak materials in place.
 */
function DimmingPass() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    // Defer to next frame so ArtworkModel's recentre layout effect has
    // populated the cloned subtree before we walk it.
    const id = window.requestAnimationFrame(() => {
      scene.traverse((node) => {
        // Match the Mesh check ArtworkModel uses; we look at `isMesh` to
        // avoid importing the Three Mesh class twice for a runtime check.
        if (!(node as { isMesh?: boolean }).isMesh) return;
        // Explicitly skip the placement marker cubes and the studio floor
        // — without this filter the traverse order would silently decide
        // which meshes get dimmed (the original code relied on the marker
        // mounting *after* this rAF, which is fragile against Suspense /
        // render-order changes). Names are owned by this module so future
        // additions stay opt-out by default.
        if (node.name === PLACEMENT_MESH_NAME) return;
        if (node.name === STUDIO_FLOOR_NAME) return;
        const mesh = node as unknown as { material: MeshStandardMaterial | MeshStandardMaterial[] };
        const apply = (m: MeshStandardMaterial) => {
          m.transparent = true;
          m.opacity = 0.35;
          m.depthWrite = false;
        };
        if (Array.isArray(mesh.material)) mesh.material.forEach(apply);
        else apply(mesh.material);
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [scene]);
  return null;
}
