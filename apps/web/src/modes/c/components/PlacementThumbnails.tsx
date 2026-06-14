import { useMemo } from "react";

import type { Placement } from "@/lib/api";

import type { Texture } from "../lib/textureApi";
import { textureUrl } from "../lib/textureApi";

type Props = {
  placements: Placement[];
  textures: Texture[];
  selectedId: string | null;
  onSelect: (placementId: string) => void;
  /** Toggle a placement's `is_show` from the strip. The per-tile checkbox
   *  is the "list" entry point the spec asks for (alongside the sidebar's). */
  onToggleShow: (placementId: string, next: boolean) => void;
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
  onToggleShow,
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
        const isShow = p.is_show !== false;
        return (
          <div key={p.id} className="relative shrink-0">
            <button
              type="button"
              onClick={() => onSelect(p.id)}
              aria-pressed={isSelected}
              aria-label={`Placement ${p.id.slice(0, 8)}`}
              className={[
                "relative block h-[60px] w-[60px] overflow-hidden rounded-md border bg-surface transition-colors",
                isSelected
                  ? "border-accent ring-2 ring-accent/40"
                  : "border-border hover:border-fg",
                // Hidden placements read faded so the strip mirrors the
                // preview canvas at a glance.
                isShow ? "" : "opacity-40",
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
            {/* is_show checkbox — the "list" toggle entry point. Sits over
                the tile so the strip stays compact; stop propagation so a
                toggle click doesn't also select the placement. */}
            <label
              className="absolute left-1 top-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded bg-black/60"
              title={isShow ? "於預覽 / AR 顯示" : "已隱藏（不顯示）"}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={isShow}
                onChange={(e) => onToggleShow(p.id, e.target.checked)}
                aria-label={`Placement ${p.id.slice(0, 8)} 顯示`}
                className="h-3 w-3 accent-accent"
              />
            </label>
          </div>
        );
      })}
      {placements.length === 0 && (
        <p className="text-xs text-muted">尚無 Placement — 先在 C2 建立物件。</p>
      )}
    </nav>
  );
}
