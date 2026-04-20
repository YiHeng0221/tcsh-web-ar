import { useGLTF } from "@react-three/drei";
import type { GLTF } from "three-stdlib";

import { ARTWORK_MODEL_URL } from "./artworkUrl";

// Pre-warm the fetch so the first navigation to B2 hits a ready cache.
// drei's useGLTF caches on the url, so this is effectively memoised.
useGLTF.preload(ARTWORK_MODEL_URL);

/**
 * Loads and renders the primary artwork glTF. Meant to be dropped inside
 * a `<Suspense>` inside an R3F `<Canvas>`. The DOM loading / error UI
 * lives in the parent screen.
 */
export function ArtworkModel() {
  // drei's useGLTF overload returns `(GLTF & ObjectMap) | (GLTF & ObjectMap)[]`
  // so narrow to the single-URL shape — TS can't prove the union itself.
  const gltf = useGLTF(ARTWORK_MODEL_URL) as GLTF;
  return <primitive object={gltf.scene} />;
}
