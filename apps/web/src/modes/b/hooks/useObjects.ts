import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { apiGet } from "@/lib/api/client";
import type { Anchor, ARObject, Placement } from "@/lib/api";

/**
 * Composite fetch for B3 / B4: the AR objects, plus the anchors and
 * placements needed to attach a station label ("Station A") to each row.
 *
 * The three fetches are parallel and cached independently. Until placements
 * exist for an object the row falls back to no station label — that's the
 * realistic state during early backend development and the UI degrades
 * cleanly.
 *
 * Why TanStack Query: matches A2StationPicker, gives us in-flight cancel
 * via `signal`, and lets us share the cache key so navigating B3 ↔ B4
 * doesn't refetch.
 */
export function useObjectsWithStations() {
  const objectsQuery = useQuery({
    queryKey: ["objects"],
    queryFn: ({ signal }) => apiGet<ARObject[]>("/objects", { signal }),
  });
  const anchorsQuery = useQuery({
    queryKey: ["anchors"],
    queryFn: ({ signal }) => apiGet<Anchor[]>("/anchors", { signal }),
  });
  const placementsQuery = useQuery({
    queryKey: ["placements"],
    queryFn: ({ signal }) => apiGet<Placement[]>("/placements", { signal }),
  });

  // Build object_id → anchor_label once per (objects, anchors, placements)
  // change. An object can sit at multiple anchors; the Figma shows one
  // station per row, so we take the first placement found — good enough
  // until the backend returns a "primary placement" or canonical sort.
  const stationByObjectId = useMemo(() => {
    const map = new Map<string, string>();
    const anchors = anchorsQuery.data ?? [];
    const placements = placementsQuery.data ?? [];
    if (anchors.length === 0 || placements.length === 0) return map;
    const anchorLabel = new Map(anchors.map((a) => [a.id, a.label]));
    for (const p of placements) {
      if (map.has(p.ar_object_id)) continue;
      const label = anchorLabel.get(p.anchor_id);
      if (label) map.set(p.ar_object_id, label);
    }
    return map;
  }, [anchorsQuery.data, placementsQuery.data]);

  return {
    objects: objectsQuery.data ?? [],
    stationByObjectId,
    isLoading: objectsQuery.isLoading,
    // Anchors / placements are decorations — surface only the objects
    // error so a missing placement endpoint doesn't gate the whole list.
    error: objectsQuery.error,
  };
}
