import { useMemo } from "react";

import type { Placement } from "@/lib/api";

import type { Texture } from "../lib/textureApi";
import { textureUrl } from "../lib/textureApi";

type Props = {
  placements: Placement[];
  textures: Texture[];
  selectedId: string | null;
  onSelect: (placementId: string) => void;
};

/**
 * Bottom-row thumbnail strip for C5. One 60×60 tile per placement, with
 * the selected tile outlined in cyan. Clicking a tile drives the same
 * `selectedId` state the canvas uses, so canvas <-> sidebar <-> thumbnail
 * stay in lockstep.
 *
 * Renders as a horizontal scroll container — once the dataset grows past
 * what fits across 1280px the strip will scroll instead of wrap. Wrapping
 * would have made the canvas + thumbnail layout reflow as the dataset
 * grows, which is the opposite of what an editor wants.
 */
export function PlacementThumbnails({
  placements,
  textures,
  selectedId,
  onSelect,
}: Props) {
  // Memoised: this strip re-renders on every selection change (arrow-key
  // navigation), and the map only depends on the textures list.
  const textureById = useMemo(
    () => new Map(textures.map((t) => [t.id, t])),
    [textures],
  );

  return (
    <nav
      aria-label="Placement 列表"
      data-testid="placement-thumbnails"
      className="flex h-[88px] shrink-0 items-center gap-2 overflow-x-auto border-t border-border bg-bg px-4"
    >
      {placements.map((p) => {
        const isSelected = p.id === selectedId;
        const texture = p.texture_id ? textureById.get(p.texture_id) : null;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            aria-pressed={isSelected}
            aria-label={`Placement ${p.id.slice(0, 8)}`}
            className={[
              "relative h-[60px] w-[60px] shrink-0 overflow-hidden rounded-md border bg-surface transition-colors",
              isSelected
                ? "border-accent ring-2 ring-accent/40"
                : "border-border hover:border-fg",
            ].join(" ")}
          >
            {texture ? (
              <img
                src={textureUrl(texture)}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] text-muted">
                ∅
              </div>
            )}
          </button>
        );
      })}
      {placements.length === 0 && (
        <p className="text-xs text-muted">尚無 Placement — 先在 C2 建立物件。</p>
      )}
    </nav>
  );
}
