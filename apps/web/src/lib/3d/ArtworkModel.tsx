import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import type { Material, Object3D } from "three";
import { Box3, Mesh, Vector3 } from "three";
import type { GLTF } from "three-stdlib";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { ARTWORK_MODEL_URL } from "./artworkUrl";

type Props = {
  /** Multiplier on the longest bbox axis when placing the camera. 1 = snug,
   *  higher = more margin. Defaults to 1.8 — comfortable framing. */
  framing?: number;
  /** Called once the cloned scene is mounted and the camera-fit pass has
   *  run. Lets the host (e.g. B2Viewer) drop its DOM-space loading
   *  overlay — Suspense alone can't signal completion to siblings outside
   *  the Canvas. */
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
 * On unmount we dispose the cloned geometry and materials (but NOT
 * textures — Material.clone() is shallow and the cloned material's texture
 * properties still point at the same Texture objects in drei's useGLTF
 * cache; disposing them here would black-screen the second visit to /b).
 * drei's `useGLTF` cache owns the raw glTF buffers and their textures, so
 * only the per-mount geometry / material objects are released here.
 * Without this a user bouncing in and out of `/b` leaks GPU memory.
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

    // On the very first mount `controls` is still null — drei's
    // <OrbitControls makeDefault> registers itself in the R3F store via a
    // useEffect, which runs after this sibling useLayoutEffect. That's
    // fine: OrbitControls' default target is already (0,0,0). On fitKey
    // remounts the controls instance exists, so the explicit set keeps a
    // user-panned target from surviving a reset.
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }

    // Signal the host that the model has loaded and the camera-fit pass
    // has run, so any DOM-space loading overlay can hide. Fires every
    // time the fit pass reruns (remount via `fitKey`, framing change),
    // which is what the host wants — a reset implicitly means "ready
    // again".
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
    // Invariant behind the empty deps: ARTWORK_MODEL_URL is a
    // module-level const (src/lib/3d/artworkUrl.ts), so the glTF — and
    // therefore `scene` — cannot change during one mount's lifetime. If
    // the URL ever becomes a prop, this cleanup must capture `scene` via
    // deps or it will dispose the wrong clone.
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

// Material.clone() is a shallow clone — texture properties on the cloned
// material still reference the same Texture objects that drei's useGLTF
// cache holds. Calling texture.dispose() here would destroy those shared
// references; the second visit to /b would get back the same (now-invalid)
// textures and render the model fully black. Only dispose the material
// object itself; drei's cache manages texture lifetimes.
function disposeMaterial(material: Material | Material[]): void {
  const dispose = (m: Material): void => m.dispose();
  if (Array.isArray(material)) material.forEach(dispose);
  else dispose(material);
}
