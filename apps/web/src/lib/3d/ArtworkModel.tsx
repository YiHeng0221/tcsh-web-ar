import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import type { Material, Object3D, Texture } from "three";
import { Box3, Mesh, Vector3 } from "three";
import type { GLTF } from "three-stdlib";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { ARTWORK_MODEL_URL } from "./artworkUrl";

/**
 * Queue the glTF fetch. Called by the mode-B / mode-C screen components
 * on mount — intentionally not a module top-level side effect, so
 * importing this module (e.g. because react-router's code-split chunk
 * gets pre-parsed) doesn't itself trigger a ~10 MB download before the
 * user visits Mode B.
 *
 * Naming note: `useGLTF.preload` is drei's *static* prefetch method (it
 * is not a React hook despite being attached to a `use*` namespace), so
 * this wrapper is a plain function. It is deliberately not named
 * `usePreloadArtwork` to avoid tripping the rules-of-hooks lint check —
 * call sites use it from `useEffect`, not as a hook.
 */
export function queueArtworkPreload(): void {
  useGLTF.preload(ARTWORK_MODEL_URL);
}

type Props = {
  /** Multiplier on the longest bbox axis when placing the camera. 1 = snug,
   *  higher = more margin. Defaults to 1.8 — comfortable framing. */
  framing?: number;
  /** Fires once after the cloned scene is recentered and the camera has
   *  been framed — i.e. the first render with the artwork actually visible.
   *  Used by B2Viewer to hide its DOM-space "載入中…" overlay. */
  onReady?: () => void;
};

/**
 * Loads, centres, and frames the primary artwork glTF.
 *
 * glTF exporters often anchor the model's pivot at a corner or the base
 * rather than the geometric centre, which made OrbitControls orbit around
 * a point in front of the artwork. We recompute the AABB after load,
 * shift the cloned scene so the centre lands at the world origin, then
 * pull the camera back along +Z to frame the whole piece and pin the
 * controls target to the origin.
 *
 * On unmount we dispose the cloned geometry / materials / textures;
 * drei's `useGLTF` cache still owns the raw glTF buffers, so only the
 * per-mount copy is released. Without this a user bouncing in and out
 * of `/b` leaks GPU memory (frontend.md: "Dispose geometry/material/
 * texture on unmount — else GPU leak").
 */
export function ArtworkModel({ framing = 1.8, onReady }: Props = {}) {
  // drei's useGLTF overload returns `(GLTF & ObjectMap) | (GLTF & ObjectMap)[]`
  // so narrow to the single-URL shape — TS can't prove the union itself.
  const gltf = useGLTF(ARTWORK_MODEL_URL) as GLTF;

  // Deep-clone the scene graph so HMR / remount works on a fresh subtree
  // without mutating drei's shared cache. `clone(true)` walks children;
  // we still need to deep-clone each mesh's geometry / material so
  // Mode A A4 (when it eventually uses the same model) can tint or
  // modify materials without disturbing this mount's copy.
  const scene = useMemo<Object3D>(() => {
    const cloned = gltf.scene.clone(true);
    cloned.traverse((node) => {
      if (node instanceof Mesh) {
        node.geometry = node.geometry.clone();
        node.material = cloneMaterial(node.material);
      }
    });
    return cloned;
  }, [gltf.scene]);

  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;

  useLayoutEffect(() => {
    const bbox = new Box3().setFromObject(scene);
    const centre = bbox.getCenter(new Vector3());
    const size = bbox.getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Recentre the scene so its geometric middle lands at world origin.
    // OrbitControls then orbits around a point that actually feels like
    // "the middle of the piece" from any angle.
    scene.position.sub(centre);

    // Back the camera off along +Z by enough to see the whole AABB with
    // a small framing margin. Near / far follow the model scale so we
    // don't clip or Z-fight on large or small glTFs.
    const distance = maxDim * framing;
    camera.position.set(0, size.y * 0.15, distance);
    camera.near = Math.max(0.01, distance / 1000);
    camera.far = distance * 100;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }

    onReady?.();
  }, [scene, camera, controls, framing, onReady]);

  // Dispose the cloned GPU resources when the component unmounts.
  // Runs once per mount (empty deps); by that time `scene` is stable
  // for this lifetime because `useMemo` above only reruns when the
  // source glTF changes (which coincides with a remount anyway).
  useLayoutEffect(() => {
    return () => {
      scene.traverse((node) => {
        if (node instanceof Mesh) {
          node.geometry?.dispose();
          disposeMaterial(node.material);
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <primitive object={scene} />;
}

/**
 * Shallow-clone a material (or every material in an array). The cloned
 * material still shares texture references with the source — we leave
 * those to drei's useGLTF cache and only dispose material / geometry
 * we own.
 */
function cloneMaterial(material: Material | Material[]): Material | Material[] {
  if (Array.isArray(material)) return material.map((m) => m.clone());
  return material.clone();
}

function disposeMaterial(material: Material | Material[]): void {
  const dispose = (m: Material): void => {
    // Dispose textures the material references. Same caveat: drei owns
    // the source textures via its cache and will dispose them when the
    // cached glTF entry is evicted, so disposing here only hurts if we
    // share a texture with the original — which we don't, because
    // `m` is a clone.
    for (const key in m) {
      const value = (m as unknown as Record<string, unknown>)[key];
      if (isTexture(value)) value.dispose();
    }
    m.dispose();
  };
  if (Array.isArray(material)) material.forEach(dispose);
  else dispose(material);
}

function isTexture(value: unknown): value is Texture {
  return (
    typeof value === "object" &&
    value !== null &&
    // Texture has a `.isTexture` discriminator from three.js.
    (value as { isTexture?: boolean }).isTexture === true
  );
}
