import { createContext, useContext } from "react";

import type { ARObject } from "@/lib/api";

/**
 * Camera-control surface exposed by B2Viewer to its overlays (B3 search,
 * B4 list).
 *
 * Why a context, not props: the overlays mount inside B2's tree but are
 * structurally separate (a sheet over the canvas vs the canvas itself),
 * and threading a `flyTo` callback through every wrapper is noisy. The
 * context lets each overlay grab the controller directly.
 *
 * Why not refs: B3 / B4 can also be reached as standalone routes (see
 * router.tsx report). A bare ref needs a host component — the context
 * gracefully degrades to `null` outside B2 so a deep-link still renders.
 *
 * `flyToObject` is async-ish in spirit: today it's a synchronous OrbitControls
 * target update, but once we wire real per-object placements (Mode C ships
 * coordinates) the implementation might animate over a few hundred ms.
 * Keep callers indifferent to that by typing the return as `void`.
 */
export type ViewerController = {
  /**
   * Frame the camera on a specific AR object. The viewer is responsible
   * for resolving the object to a world position (placement lookup) and
   * tweening OrbitControls' target / camera distance.
   */
  flyToObject: (object: ARObject) => void;
  /** Reset framing to the whole-artwork default. */
  resetView: () => void;
};

export const ViewerContext = createContext<ViewerController | null>(null);

/**
 * Subscribe to the parent B2Viewer's camera controller. Returns `null`
 * when the consumer is rendered standalone (e.g. /b/search deep-link),
 * which lets B3 / B4 fall back to a navigation-only behaviour instead
 * of crashing.
 */
export function useViewerController(): ViewerController | null {
  return useContext(ViewerContext);
}
