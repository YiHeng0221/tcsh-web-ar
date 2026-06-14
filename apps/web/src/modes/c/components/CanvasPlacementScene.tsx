import { Html, OrbitControls, TransformControls, useGLTF } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Camera,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from "three";
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
import type { GLTF } from "three-stdlib";

import { ArtworkModel, queueArtworkPreload } from "@/lib/3d/ArtworkModel";
import { ModelErrorBoundary } from "@/lib/3d/ModelErrorBoundary";
import type { Placement, Vec3 } from "@/lib/api";

import {
  IronFrameModel,
  queueIronFramePreload,
} from "./IronFrameModel";
import { classifyPointerGesture } from "../lib/pointerGesture";
import type { Texture as TextureRecord } from "../lib/textureApi";
import { textureKind, textureUrl } from "../lib/textureApi";
import { TEXTURE_DRAG_MIME } from "./TexturePalette";

/** View mode for the editor canvas.
 *  - `isolation`: render only the bare iron frame + the single selected
 *    placement. Lets the admin focus on positioning one piece.
 *  - `preview`: render every `is_show` placement together (frame optional)
 *    so the admin can sanity-check the whole composition. */
export type CanvasViewMode = "isolation" | "preview";

/** Which modifier scales (Cmd on mac, Ctrl elsewhere) — kept distinct from
 *  the Ctrl orbit modifier so the two never fight over the same key. */
const SCALE_USES_META =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/**
 * Right-handed, anchor-relative marker that visualises a single placement
 * inside the editor canvas. An image texture (or empty placement) renders
 * as a unit cube tinted by the placement's `transform`; a glTF ("model")
 * texture renders the model itself at the placement transform.
 *
 * The selected placement gets an emissive cyan tint plus an edge outline so
 * the admin can visually confirm what the right-side form is editing. A
 * placement with `is_show === false` is drawn semi-transparent in preview
 * so the admin can see it's there but knows it won't ship to AR.
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
  /** Render dimmed (is_show === false). Visible-but-faded so the admin sees
   *  it's there yet excluded from the published preview / AR. */
  dimmed: boolean;
  /** Ref callback so the parent can hand the selected marker's group to the
   *  TransformControls gizmo. Only the selected marker registers itself. */
  groupRef?: (group: Group | null) => void;
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
  dimmed,
  groupRef,
}: PlacementMarkerProps) {
  // Resolve the live (override) transform so dragging the gizmo / form
  // sliders updates the marker without waiting for a save round-trip.
  const position = override?.position ?? placement.transform.position;
  const scale = override?.scale ?? placement.transform.scale;

  const textureRecord = override?.texture ?? null;
  const isModel = textureRecord != null && textureKind(textureRecord) === "model";

  return (
    <group
      ref={groupRef}
      // Tag the marker group with the placement id so the wrapper's
      // raycaster (which walks ancestors) resolves both box + glTF markers
      // to a placement — the glTF clone's sub-meshes don't each carry the id.
      userData={{ [PLACEMENT_ID_USERDATA_KEY]: placement.id }}
      name={PLACEMENT_MESH_NAME}
      position={[position.x, position.y, position.z]}
      scale={[
        Math.max(scale.x, 0.001),
        Math.max(scale.y, 0.001),
        Math.max(scale.z, 0.001),
      ]}
      onPointerDown={(e) => {
        // stopPropagation so a click on the front face doesn't also trigger
        // the back face / OrbitControls' own pointer handler. We DON'T call
        // onSelect here anymore — selection is driven by the wrapper's
        // click-vs-drag arbitration (see CanvasPlacementScene) so an orbit
        // drag that happens to start on a marker doesn't select it.
        e.stopPropagation();
      }}
    >
      {isModel && textureRecord ? (
        <PlacementGlbTexture
          texture={textureRecord}
          selected={selected}
          dimmed={dimmed}
        />
      ) : (
        <PlacementImageMarker
          texture={textureRecord}
          selected={selected}
          dropHovered={dropHovered}
          dimmed={dimmed}
        />
      )}

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
 * 2D-image (or empty) placement marker: a unit cube whose front face shows
 * the texture. The cube is the raycaster's hit target (named so the wrapper
 * can filter to markers only).
 */
function PlacementImageMarker({
  texture,
  selected,
  dropHovered,
  dimmed,
}: {
  texture: TextureRecord | null;
  selected: boolean;
  dropHovered: boolean;
  dimmed: boolean;
}) {
  // Lazy-load the texture image as a Three texture. We don't use drei's
  // `useTexture` because (a) the URL might be missing (placement with no
  // texture yet) and (b) we want a graceful fallback to a flat colour, not
  // a Suspense throw that crashes the canvas.
  //
  // Lifecycle: every time the texture record id changes we load a fresh
  // ThreeTexture and dispose the previous one on cleanup — else the GPU
  // leaks one texture per selection switch.
  const textureRecordId = texture?.id ?? null;
  const [textureImage, setTextureImage] = useState<ThreeTexture | null>(null);
  useEffect(() => {
    if (!texture) {
      setTextureImage(null);
      return;
    }
    const tex = TEXTURE_LOADER.load(textureUrl(texture));
    tex.flipY = false;
    setTextureImage(tex);
    return () => {
      tex.dispose();
    };
    // Identity-only dep: a parent re-render handing the same record by value
    // should not retrigger a fetch/dispose cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textureRecordId]);

  const baseColor = selected ? "#00e5ff" : "#c97a48";
  const emissiveColor = dropHovered
    ? "#34d399"
    : selected
      ? "#00e5ff"
      : "#000000";
  const emissiveIntensity = dropHovered ? 0.7 : selected ? 0.35 : 0;

  return (
    <mesh castShadow receiveShadow name={PLACEMENT_MESH_NAME}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={textureImage ? "#ffffff" : baseColor}
        map={textureImage}
        emissive={emissiveColor}
        emissiveIntensity={emissiveIntensity}
        side={DoubleSide}
        metalness={0.05}
        roughness={0.9}
        transparent={dimmed}
        opacity={dimmed ? 0.3 : 1}
        depthWrite={!dimmed}
      />
    </mesh>
  );
}

/**
 * glTF ("model"-kind) placement marker. Loads the texture's binary as a
 * glTF and renders a deep-clone of it at the placement transform. The
 * clone's meshes are renamed to {@link PLACEMENT_MESH_NAME} so the
 * drag-and-drop + selection raycaster treats the whole model as one hit
 * target, and tagged with the placement id via userData so picks resolve.
 *
 * Selection / dim feedback is applied by walking the clone's materials
 * (emissive tint on select, opacity on dim) — we can't tint via props the
 * way the box marker does because the model brings its own materials.
 */
function PlacementGlbTexture({
  texture,
  selected,
  dimmed,
}: {
  texture: TextureRecord;
  selected: boolean;
  dimmed: boolean;
}) {
  const gltf = useGLTF(textureUrl(texture)) as GLTF;

  const scene = useMemo<Object3D>(() => {
    const cloned = gltf.scene.clone(true);
    cloned.traverse((node) => {
      const mesh = node as Mesh & { isMesh?: boolean };
      if (!mesh.isMesh) return;
      mesh.geometry = mesh.geometry.clone();
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : mesh.material.clone();
      // Name each sub-mesh so the raycaster's name path matches; the
      // placement id lives on the marker group (set by PlacementMarker).
      mesh.name = PLACEMENT_MESH_NAME;
    });
    return cloned;
    // gltf.scene identity is stable per URL via the drei cache.
  }, [gltf.scene]);

  // Apply selection emissive + dim opacity by walking the clone's
  // materials. Re-runs on selection / dim flips.
  useEffect(() => {
    scene.traverse((node) => {
      const mesh = node as Mesh & { isMesh?: boolean };
      if (!mesh.isMesh) return;
      const apply = (m: MeshStandardMaterial) => {
        if (m.emissive) {
          m.emissive.set(selected ? "#00e5ff" : "#000000");
          m.emissiveIntensity = selected ? 0.25 : 0;
        }
        m.transparent = dimmed;
        m.opacity = dimmed ? 0.3 : 1;
        m.depthWrite = !dimmed;
        m.needsUpdate = true;
      };
      const mat = mesh.material as
        | MeshStandardMaterial
        | MeshStandardMaterial[];
      if (Array.isArray(mat)) mat.forEach(apply);
      else apply(mat);
    });
  }, [scene, selected, dimmed]);

  // Dispose the per-mount geometry + cloned materials on unmount. Textures
  // belong to drei's useGLTF cache.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  useEffect(() => {
    return () => {
      sceneRef.current.traverse((node) => {
        const mesh = node as Mesh & { isMesh?: boolean };
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mat = mesh.material as
          | MeshStandardMaterial
          | MeshStandardMaterial[];
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      });
    };
  }, []);

  return <primitive object={scene} />;
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
 * Module-level singleton so every C5 entry/exit reuses the same GPU texture
 * — no per-mount CanvasTexture leak, no regen cost on remount. Lazy because
 * the module may load where `document` isn't available (tests, SSR).
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
 * Floor grid drawn beneath the artwork — gives admins a sense of scale.
 * The 1024×1024 CanvasTexture is built once at module level, so admin
 * in/out of C5 doesn't accumulate GPU resources.
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
 * Camera initialiser — positions the orbit camera the first time the scene
 * mounts so the artwork plus markers fit in the viewport. After that we
 * hand control to OrbitControls; we don't want to fight the user's drags.
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
  /** Called when the canvas detects a click on empty space (deselect). */
  onDeselect?: () => void;
  /** Live position override for the selected placement, mirroring the
   *  side-panel form + gizmo drag so canvas + form stay in lockstep. */
  selectedOverride?: PlacementMarkerProps["override"];
  /** Resolved texture record for the selected placement. */
  selectedTexture?: TextureRecord | null;
  /** Texture lookup by placement id, so every marker (preview mode) can show
   *  its own saved texture, not just the selected one. */
  textureForPlacement?: (placement: Placement) => TextureRecord | null;
  /** Fired when a texture is dropped on a placement marker. */
  onTextureDrop?: (placementId: string, textureId: string) => void;
  /** View mode: isolation (frame + selected only) vs preview (all is_show). */
  viewMode: CanvasViewMode;
  /** Fired by the gizmo on each translate change — live position in world
   *  space. The screen feeds this back into the form. */
  onGizmoMove?: (position: Vec3) => void;
  /** Fired by Cmd/Meta + wheel over the canvas — a multiplicative scale
   *  delta (e.g. 1.05 / 0.95) for the selected placement. */
  onScaleDelta?: (factor: number) => void;
  /** Optional className for sizing. */
  className?: string;
  /** Slot rendered above the R3F canvas (texture palette etc.). */
  overlay?: React.ReactNode;
};

/**
 * Snapshot of the live R3F scene refs (camera + scene root) lifted out of
 * `<Canvas>` so the outer pointer / drop handlers can raycast against them.
 */
type SceneRefs = { camera: Camera; scene: Object3D } | null;


/**
 * The R3F canvas at the heart of C5. Renders the iron frame (isolation) or
 * the textured artwork backdrop (preview) plus a marker per visible
 * placement. Interaction is Blender-style:
 *
 *  - Nothing selected → drag orbits (OrbitControls).
 *  - pointerdown/up with < 6px move & < 300ms → click: raycast to
 *    select / deselect. ≥ 6px → drag: orbit, we stay out of the way.
 *  - Selected → an xyz gizmo (TransformControls, translate) appears;
 *    dragging it moves the placement (drei auto-pauses orbit while
 *    dragging the gizmo).
 *  - Cmd/Meta + wheel → scale the selected placement.
 *  - Hold Ctrl → temporarily re-enable orbit even while a placement is
 *    selected (turn the view mid-edit); release restores edit mode.
 *  - Esc / click empty → deselect.
 *
 * The wrapping `<div>` doubles as the HTML5 drop target for texture
 * drag-and-drop (raycast in HTML space because drag events don't reach the
 * R3F event system).
 */
export function CanvasPlacementScene({
  placements,
  selectedId,
  onSelect,
  onDeselect,
  selectedOverride,
  selectedTexture,
  textureForPlacement,
  onTextureDrop,
  viewMode,
  onGizmoMove,
  onScaleDelta,
  className,
  overlay,
}: CanvasPlacementSceneProps) {
  useEffect(() => {
    // Keep the ~10 MB glTF preloads off the module top level. Isolation
    // needs the iron frame; preview leans on the textured artwork backdrop.
    queueArtworkPreload();
    queueIronFramePreload();
  }, []);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const sceneRefsRef = useRef<SceneRefs>(null);
  const raycasterRef = useRef<Raycaster | null>(null);
  const ndcRef = useRef<Vector2 | null>(null);
  // The selected marker's group, handed to TransformControls. Held in state
  // (not a ref) so attaching the gizmo re-renders once the group mounts.
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  // True while the Ctrl key is held — flips the canvas back to orbit even
  // with a placement selected.
  const [ctrlOrbit, setCtrlOrbit] = useState(false);
  // Set true on TransformControls mousedown, cleared shortly after mouseup.
  // The wrapper's click-vs-drag arbitration reads it to avoid treating a
  // gizmo interaction as an "empty click" that would deselect.
  const gizmoActiveRef = useRef(false);

  function getRaycaster(): Raycaster {
    if (!raycasterRef.current) raycasterRef.current = new Raycaster();
    return raycasterRef.current;
  }
  function getNdc(): Vector2 {
    if (!ndcRef.current) ndcRef.current = new Vector2();
    return ndcRef.current;
  }

  const [dropHoverId, setDropHoverId] = useState<string | null>(null);

  /** Raycast against marker meshes and return the topmost placement id, or
   *  null over empty space / the frame / floor. */
  const pickPlacementAt = useCallback(
    (clientX: number, clientY: number): string | null => {
      const wrapper = wrapperRef.current;
      const refs = sceneRefsRef.current;
      if (!wrapper || !refs) return null;

      const rect = wrapper.getBoundingClientRect();
      const ndc = getNdc();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
      if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1) return null;

      const raycaster = getRaycaster();
      raycaster.setFromCamera(ndc, refs.camera);
      const intersects = raycaster.intersectObjects(refs.scene.children, true);
      for (const hit of intersects) {
        // Only consider marker-tagged meshes (skip frame / floor / artwork),
        // then walk up to the marker group that carries the placement id.
        if (hit.object.name !== PLACEMENT_MESH_NAME) continue;
        let obj: Object3D | null = hit.object;
        while (obj) {
          const id = obj.userData?.[PLACEMENT_ID_USERDATA_KEY];
          if (typeof id === "string") return id;
          obj = obj.parent;
        }
      }
      return null;
    },
    [],
  );

  // ── Click vs drag arbitration ───────────────────────────────────────
  // Record the pointerdown origin; on pointerup decide click vs drag by
  // displacement + elapsed time. A click raycasts to select / deselect; a
  // drag was an orbit gesture OrbitControls already serviced.
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null);

  // useCallback so the wrapper div's listeners don't churn on every
  // canvas re-render (selection / gizmo-drag / Ctrl toggles all re-render).
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only arbitrate primary-button presses; secondary / middle are
      // pan / dolly gestures owned entirely by OrbitControls.
      if (e.button !== 0) {
        downRef.current = null;
        return;
      }
      downRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    },
    [],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const down = downRef.current;
      downRef.current = null;
      if (!down || e.button !== 0) return;
      // A gizmo interaction (drag or click on the handles) is not a canvas
      // click — bail so the deselect branch doesn't fire and kick the admin
      // out of edit mode while they're nudging the gizmo.
      if (gizmoActiveRef.current) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      const moved = Math.hypot(dx, dy);
      const elapsed = performance.now() - down.t;
      // Drag → orbit already handled it; stay out of the way.
      if (classifyPointerGesture(moved, elapsed) === "drag") return;
      // Click → select the hit placement, or deselect on empty space.
      const hitId = pickPlacementAt(e.clientX, e.clientY);
      if (hitId) {
        if (hitId !== selectedId) onSelect(hitId);
      } else {
        onDeselect?.();
      }
    },
    [pickPlacementAt, selectedId, onSelect, onDeselect, gizmoActiveRef],
  );

  // ── Ctrl-orbit + Esc-deselect key handling ──────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control") {
        setCtrlOrbit(true);
        return;
      }
      if (e.key === "Escape" && selectedId) {
        onDeselect?.();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") setCtrlOrbit(false);
    };
    // Reset on blur so a Ctrl held across a focus loss doesn't stick.
    const onBlur = () => setCtrlOrbit(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [selectedId, onDeselect]);

  // ── Cmd/Meta + wheel → scale ────────────────────────────────────────
  // Attached natively (not via React's onWheel) so we can call
  // preventDefault with passive:false and stop the browser zoom / page
  // scroll. Only fires when a placement is selected and Meta is held.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!selectedId) return;
      // The scale modifier is platform-specific and must NOT collide with
      // the orbit modifier:
      //   - mac: Cmd (metaKey) scales; Ctrl is reserved for orbit (above).
      //   - others: Ctrl scales (mac's Ctrl+wheel pinch-zoom convention
      //     doesn't apply, and these platforms have no Cmd).
      // Picking one key per platform means a held Ctrl on mac keeps
      // meaning "orbit", never "scale".
      const scaleHeld = SCALE_USES_META ? e.metaKey : e.ctrlKey;
      if (!scaleHeld) return;
      e.preventDefault();
      // Normalise direction: wheel up (deltaY < 0) grows, down shrinks.
      const factor = e.deltaY < 0 ? 1.05 : 0.95;
      onScaleDelta?.(factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [selectedId, onScaleDelta]);

  // ── Drag-and-drop (texture assignment) ──────────────────────────────
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!isTextureDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const hitId = pickPlacementAt(e.clientX, e.clientY);
    setDropHoverId((prev) => (prev === hitId ? prev : hitId));
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
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

  // ── Which placements to render ──────────────────────────────────────
  // Isolation: only the selected one. Preview: every placement, with
  // is_show === false drawn dimmed.
  const visiblePlacements = useMemo(() => {
    if (viewMode === "isolation") {
      return placements.filter((p) => p.id === selectedId);
    }
    return placements;
  }, [placements, selectedId, viewMode]);

  // Gizmo is active only in isolation (edit) mode, when a placement is
  // selected, the editor isn't in Ctrl-orbit mode, and the selected
  // marker's group has mounted. Preview mode is read-only — no gizmo.
  const gizmoActive =
    viewMode === "isolation" && !!selectedId && !!selectedGroup && !ctrlOrbit;

  return (
    <div
      ref={wrapperRef}
      className={`relative ${className ?? ""}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
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
            {viewMode === "isolation" ? (
              // Isolation: the bare iron frame, opaque, as the focus backdrop.
              <IronFrameModel opacity={1} />
            ) : (
              // Preview: the textured artwork dimmed so markers read on top.
              <group>
                <ArtworkModelDimmed />
              </group>
            )}
          </Suspense>

          <StudioFloor />

          {visiblePlacements.map((p) => {
            const isSelected = p.id === selectedId;
            const dimmed = viewMode === "preview" && p.is_show === false;
            const savedTexture = textureForPlacement?.(p) ?? null;
            return (
              <PlacementMarker
                key={p.id}
                placement={p}
                selected={isSelected}
                dropHovered={p.id === dropHoverId}
                dimmed={dimmed}
                groupRef={isSelected ? setSelectedGroup : undefined}
                override={
                  isSelected
                    ? {
                        ...selectedOverride,
                        texture: selectedTexture ?? undefined,
                      }
                    : { texture: savedTexture ?? undefined }
                }
              />
            );
          })}

          {gizmoActive && selectedGroup && (
            <TransformControls
              object={selectedGroup}
              mode="translate"
              onMouseDown={() => {
                gizmoActiveRef.current = true;
              }}
              onMouseUp={() => {
                // Clear after the current event loop tick so the wrapper's
                // pointerup (which fires after the gizmo's) still sees the
                // guard and skips the deselect branch.
                window.setTimeout(() => {
                  gizmoActiveRef.current = false;
                }, 0);
              }}
              onObjectChange={() => {
                const p = selectedGroup.position;
                onGizmoMove?.({ x: p.x, y: p.y, z: p.z });
              }}
            />
          )}

          <OrbitControls
            makeDefault
            // Orbit is the default gesture except in isolation edit mode
            // where the gizmo owns the drag — there it re-enables only when
            // nothing's selected OR Ctrl is held. Preview is always orbit.
            enabled={viewMode === "preview" || !selectedId || ctrlOrbit}
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

/** True if the dragged payload is one of our texture drags. */
function isTextureDrag(e: React.DragEvent<HTMLElement>): boolean {
  for (const t of e.dataTransfer.types) {
    if (t === TEXTURE_DRAG_MIME) return true;
  }
  return false;
}

/**
 * Tiny child of `<Canvas>` whose only job is to copy the live camera +
 * scene refs into a parent ref so the wrapping `<div>`'s pointer / drop
 * handlers can run a raycaster outside the R3F event system.
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
 * Wraps `ArtworkModel` with a translucent override material so the textured
 * artwork reads as scaffolding behind the placement markers in preview
 * mode. The model component deep-clones its meshes, so adjusting opacity
 * here doesn't bleed back to other Mode B / Mode A mounts.
 */
function ArtworkModelDimmed() {
  return (
    <group renderOrder={-1}>
      <ArtworkModel framing={2.4} />
      <DimmingPass />
    </group>
  );
}

/**
 * Dims the artwork's meshes on the next frame. We can't reach into
 * ArtworkModel's cloned scene from props, so we walk the scene once after
 * mount and tweak materials in place — skipping the markers + floor by name.
 */
function DimmingPass() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      scene.traverse((node) => {
        if (!(node as { isMesh?: boolean }).isMesh) return;
        if (node.name === PLACEMENT_MESH_NAME) return;
        if (node.name === STUDIO_FLOOR_NAME) return;
        const mesh = node as unknown as {
          material: MeshStandardMaterial | MeshStandardMaterial[];
        };
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
