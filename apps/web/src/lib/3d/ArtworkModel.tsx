import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import { Box3, Vector3 } from "three";
import type { GLTF } from "three-stdlib";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { ARTWORK_MODEL_URL } from "./artworkUrl";

// Pre-warm the fetch so the first navigation to B2 hits a ready cache.
// drei's useGLTF caches on the url, so this is effectively memoised.
useGLTF.preload(ARTWORK_MODEL_URL);

type Props = {
  /** Multiplier on the longest bbox axis when placing the camera. 1 = snug,
   *  higher = more margin. Defaults to 1.8 — comfortable framing. */
  framing?: number;
};

/**
 * Loads, centers, and frames the primary artwork glTF.
 *
 * glTF exporters often anchor the model's pivot at a corner or the base
 * rather than the geometric centre, which made OrbitControls orbit around
 * a point in front of the artwork. We recompute the AABB after load,
 * shift the scene so the centre lands at the world origin, then pull the
 * camera back along +Z to frame the whole piece and pin the controls
 * target to the origin. One pass; no repeated work, no viewport resize
 * observer needed (the fit is independent of canvas size once the camera
 * distance is right).
 */
export function ArtworkModel({ framing = 1.8 }: Props = {}) {
  // drei's useGLTF overload returns `(GLTF & ObjectMap) | (GLTF & ObjectMap)[]`
  // so narrow to the single-URL shape — TS can't prove the union itself.
  const gltf = useGLTF(ARTWORK_MODEL_URL) as GLTF;

  // Clone so remount / HMR re-runs the framing effect against a fresh
  // scene graph (modifying gltf.scene directly mutates drei's cache).
  const scene = useMemo(() => gltf.scene.clone(), [gltf.scene]);

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
  }, [scene, camera, controls, framing]);

  return <primitive object={scene} />;
}
