/**
 * `usePlacements(stationId)` — the single data boundary the AR render layer
 * reads from. Hands back a flat, render-ready list of quads (position /
 * rotation quaternion / scale + texture URL) for the given station.
 *
 * Wired to the real API (2026-06-13):
 *
 *   1. The QR encodes the station's human-readable LABEL (`demo-01`); the
 *      API keys placements by anchor UUID. We resolve label → UUID off the
 *      (tiny, ≤ a dozen rows) `GET /anchors` list — no bespoke endpoint
 *      needed, and the list is cached for the whole session.
 *   2. `GET /placements?anchor_id={uuid}` → map each `PlacementOut`'s
 *      `transform` into a `RenderPlacement`. Texture binaries come from the
 *      API's own URL (`/textures/{id}/file`) through the same-origin `/api`
 *      proxy, so phones on LAN + the HTTPS dev origin both work (mixed
 *      content stays impossible by construction).
 *   3. Placements without a texture are dropped — Mode A renders textured
 *      quads only (an untextured placement has nothing to show).
 *
 * Demo resilience: if the API is unreachable AND the station is the demo
 * station, fall back to the in-repo mock fixture (identical coordinates —
 * the seed mirrors it) so a dead backend can't brick a field demo.
 *
 * No placement *logic* lives here (CLAUDE.md hard rule): the client renders
 * placements, it does not decide them.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Anchor, Placement } from "@/lib/api";
import { apiGet } from "@/lib/api/client";
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

/** Same-origin API prefix (matches lib/api/client.ts's BASE). */
const API_PREFIX = "/api";

function toRenderPlacement(p: Placement): RenderPlacement | null {
  if (!p.texture_id) return null; // nothing to draw without a texture
  const t = p.transform;
  return {
    id: p.id,
    textureUrl: `${API_PREFIX}/textures/${p.texture_id}/file`,
    position: [t.position.x, t.position.y, t.position.z],
    rotation: [t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w],
    scale: [t.scale.x, t.scale.y, t.scale.z],
  };
}

function mockFallback(stationId: string | undefined): RenderPlacement[] {
  if (stationId !== MOCK_STATION_ID) return [];
  return MOCK_PLACEMENTS.map((p) => ({
    id: p.id,
    textureUrl: p.textureUrl,
    position: p.position,
    rotation: p.rotation,
    scale: p.scale,
  }));
}

export function usePlacements(
  stationId: string | undefined,
): UsePlacementsResult {
  // Label → UUID. The anchors list is small and session-stable; one query
  // serves every station the visitor walks to.
  const anchorsQuery = useQuery({
    queryKey: ["anchors"],
    queryFn: ({ signal }) => apiGet<Anchor[]>("/anchors", { signal }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const anchorId = useMemo(() => {
    if (!stationId || !anchorsQuery.data) return undefined;
    return anchorsQuery.data.find((a: Anchor) => a.label === stationId)?.id;
  }, [stationId, anchorsQuery.data]);

  // Query key includes everything that shapes the response (REVIEW.md).
  const placementsQuery = useQuery({
    queryKey: ["placements", "by-anchor", anchorId],
    queryFn: ({ signal }) =>
      apiGet<Placement[]>(`/placements?anchor_id=${anchorId}`, { signal }),
    enabled: anchorId != null,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const placements = useMemo<RenderPlacement[]>(() => {
    if (placementsQuery.data) {
      return placementsQuery.data
        .map((p: Placement) => toRenderPlacement(p))
        .filter((p: RenderPlacement | null): p is RenderPlacement => p !== null);
    }
    // API path not (yet) available. While loading, render nothing — the
    // quads pop in when data lands. On ERROR, keep the field demo alive
    // with the mock fixture (same coordinates as the seed).
    if (anchorsQuery.isError || placementsQuery.isError) {
      return mockFallback(stationId);
    }
    return [];
  }, [
    placementsQuery.data,
    placementsQuery.isError,
    anchorsQuery.isError,
    stationId,
  ]);

  return {
    placements,
    isLoading:
      anchorsQuery.isLoading ||
      (anchorId != null && placementsQuery.isLoading),
    error: anchorsQuery.error ?? placementsQuery.error ?? null,
  };
}
