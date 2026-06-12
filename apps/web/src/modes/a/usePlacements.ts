/**
 * `usePlacements(stationId)` — the single data boundary the ARView render
 * layer reads from. It hands back a flat, render-ready list of quads
 * (position / rotation quaternion / scale + texture URL) for the given
 * station, decoupling the R3F layer from where that data comes from.
 *
 * ── MOCK → API SWITCH POINT ────────────────────────────────────────────────
 * Today this returns the in-repo `MOCK_PLACEMENTS` fixture whenever the
 * scanned station is the demo station (`demo-01`); other stations resolve to
 * an empty list (nothing seeded yet). When the backend placements pipeline is
 * wired up, replace the body of `useMockPlacements` with a TanStack Query that
 * hits `GET /api/placements?anchor_id={stationId}` and maps each
 * `PlacementOut` (`transform.position` / `.rotation` / `.scale` Vec3/Quat +
 * `texture_id` → `/api/textures/{texture_id}/file`) into `RenderPlacement`.
 * The shape below already mirrors `Transform`, so the swap is type-compatible
 * and nothing in ARView changes. The query key MUST include `stationId`
 * (REVIEW.md: TanStack keys include all inputs that affect the response).
 *
 * No placement *logic* lives here (CLAUDE.md hard rule): the client renders
 * placements, it does not decide them.
 */

import { useMemo } from "react";

import { MOCK_PLACEMENTS, MOCK_STATION_ID } from "@/lib/ar/mock-placements";

/** A render-ready quad in the anchor frame (metres). Mirrors `Transform`. */
export type RenderPlacement = {
  id: string;
  textureUrl: string;
  /** Metres, anchor frame. */
  position: [x: number, y: number, z: number];
  /** Quaternion [x, y, z, w], anchor frame. */
  rotation: [x: number, y: number, z: number, w: number];
  /** Quad size in metres — [width, height, depth]. */
  scale: [sx: number, sy: number, sz: number];
};

export type UsePlacementsResult = {
  placements: RenderPlacement[];
  isLoading: boolean;
  error: unknown;
};

export function usePlacements(stationId: string | undefined): UsePlacementsResult {
  // The mock fixture is the only source for now. `useMemo` keeps the array
  // reference stable so the R3F children don't re-key every render.
  const placements = useMemo<RenderPlacement[]>(() => {
    if (stationId === MOCK_STATION_ID) {
      // MockPlacement already matches RenderPlacement structurally.
      return MOCK_PLACEMENTS.map((p) => ({
        id: p.id,
        textureUrl: p.textureUrl,
        position: p.position,
        rotation: p.rotation,
        scale: p.scale,
      }));
    }
    // TODO(api): non-demo stations have no seeded mock data — once the
    // placements API lands, this branch fetches by anchor_id instead.
    return [];
  }, [stationId]);

  return { placements, isLoading: false, error: null };
}
