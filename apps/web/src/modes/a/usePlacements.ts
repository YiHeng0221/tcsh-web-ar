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

import type { Anchor, Placement, components } from "@/lib/api";

type Texture = components["schemas"]["TextureOut"];
import { apiGet } from "@/lib/api/client";
import { MOCK_PLACEMENTS, MOCK_STATION_ID } from "@/lib/ar/mock-placements";

/** A render-ready placement in the anchor frame (metres). Mirrors `Transform`. */
export type RenderPlacement = {
  id: string;
  textureUrl: string;
  /** "image" → draw on a quad; "model" → load the URL as a glTF. Resolved
   *  from the texture's mime on the backend (TextureOut.kind). */
  kind: "image" | "model";
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

function toRenderPlacement(
  p: Placement,
  kindById: Map<string, "image" | "model">,
): RenderPlacement | null {
  if (!p.texture_id) return null; // nothing to draw without a texture
  if (p.is_show === false) return null; // artist hid it (Mode C is_show)
  const t = p.transform;
  return {
    id: p.id,
    textureUrl: `${API_PREFIX}/textures/${p.texture_id}/file`,
    // Unknown texture (not in the index yet) → assume image; the quad path
    // is the safe default, a glb on it just renders nothing.
    kind: kindById.get(p.texture_id) ?? "image",
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
    kind: "image" as const, // mock fixtures are all 2D PNGs
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

  // Texture index → kind map (image vs glb), so the render layer picks a
  // path. Small list, session-stable; one query for every station.
  const texturesQuery = useQuery({
    queryKey: ["textures"],
    queryFn: ({ signal }) => apiGet<Texture[]>("/textures", { signal }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const kindById = useMemo(() => {
    const m = new Map<string, "image" | "model">();
    for (const t of texturesQuery.data ?? []) {
      m.set(t.id, t.kind === "model" ? "model" : "image");
    }
    return m;
  }, [texturesQuery.data]);

  const placements = useMemo<RenderPlacement[]>(() => {
    if (placementsQuery.data) {
      return placementsQuery.data
        .map((p: Placement) => toRenderPlacement(p, kindById))
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
    kindById,
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
