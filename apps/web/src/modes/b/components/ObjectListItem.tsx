import type { ARObject } from "@/lib/api";

/**
 * Single row in B3 search results / B4 list. Matches the Figma rhythm:
 * 56-px coloured swatch + label/sub-label/caption stack.
 *
 * The "swatch" colour today is derived deterministically from the object
 * id — once Mode C ships cover thumbnails (#NN), swap the `<div>` for an
 * `<img>` of the texture. Keeping a stable per-id colour means the row
 * doesn't flicker as the API order changes between fetches.
 */
interface Props {
  object: ARObject;
  /** Optional anchor caption (e.g. "Station A"). Derived by the parent —
   *  B3 / B4 both have access to the placements / anchors lookup. */
  stationLabel?: string;
  /** Sequential index in the *visible* list. The Figma uses zero-padded
   *  three-digit codes ("物件 042"); ids are UUIDs so we display this
   *  ordinal instead until backend exposes a short_code. */
  index: number;
  onSelect: (object: ARObject) => void;
  /** Variant: "row" (default) for B3 list / B4 mobile, "card" for B4
   *  tablet-landscape grid where the item lives in a bordered cell. */
  variant?: "row" | "card";
}

export function ObjectListItem({
  object,
  stationLabel,
  index,
  onSelect,
  variant = "row",
}: Props) {
  const swatch = swatchColor(object.id);
  const code = formatCode(index);
  const label = object.label?.trim() || "—";

  const containerClass =
    variant === "card"
      ? "flex w-full items-center gap-3 rounded-card border border-a1-hairline bg-white px-3 py-3 text-left transition-colors hover:bg-black/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a1-ink"
      : "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.03] focus-visible:bg-black/[0.05] focus-visible:outline-none";

  return (
    <button
      type="button"
      onClick={() => onSelect(object)}
      className={containerClass}
      aria-label={`${code} ${label}${stationLabel ? `（${stationLabel}）` : ""}`}
      data-testid="mode-b-object-row"
      data-object-id={object.id}
    >
      <span
        aria-hidden
        className="h-12 w-12 shrink-0 rounded-tile"
        style={{ backgroundColor: swatch }}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-a1-ink">
          物件 {code}
        </span>
        <span className="truncate text-xs text-a1-ink-soft">{label}</span>
        {stationLabel && (
          <span className="truncate text-[11px] text-a1-caption">
            {stationLabel}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Stable hash → hue mapping. The mockups use a warm earth-tone palette
 * (orange / brown / sienna), so we constrain hue to 18°–32° and pick
 * lightness from the hash to get the variation visible in the Figma.
 *
 * Pure function so React.memo / list virtualization downstream stays
 * trivially safe.
 */
function swatchColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = 18 + (hash % 14); // 18°–31°
  const sat = 55 + ((hash >> 4) % 20); // 55–74 %
  const light = 28 + ((hash >> 8) % 22); // 28–49 %
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function formatCode(index: number): string {
  return String(index + 1).padStart(3, "0");
}
