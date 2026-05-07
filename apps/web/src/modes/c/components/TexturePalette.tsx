import { useMemo, useState } from "react";

import type { Texture } from "../lib/textureApi";
import { textureUrl } from "../lib/textureApi";

/**
 * Mime type used to ferry a texture id through the HTML5 drag-and-drop
 * dataTransfer object. Custom mime keeps us from clashing with browser
 * built-ins (`text/plain`, `text/uri-list`) that would let any random page
 * accept our drags. Re-exported from the canvas + sidebar so the three
 * sites read/write the same key.
 */
export const TEXTURE_DRAG_MIME = "application/x-tcsh-texture-id";

type Props = {
  textures: Texture[];
  /** Optional id of the texture currently bound to the active placement —
   *  used to highlight which palette tile is "in use" so designers can spot
   *  it at a glance. */
  activeTextureId?: string | null;
};

/**
 * Floating texture palette pinned to the top-left of the canvas area. Each
 * 60×60 tile is a drag source: dragging a tile and dropping it on a
 * placement marker rebinds that placement's `texture_id`.
 *
 * Collapsible because the palette competes with the OrbitControls drag
 * gesture for canvas real estate; admins who don't need it can tuck it
 * away. Stored locally — the screen above doesn't care.
 */
export function TexturePalette({ textures, activeTextureId }: Props) {
  const [open, setOpen] = useState(true);

  // Keep the active tile first so it's always reachable without scrolling
  // through hundreds of textures. Stable sort: rest preserves server order.
  const ordered = useMemo(() => {
    if (!activeTextureId) return textures;
    const idx = textures.findIndex((t) => t.id === activeTextureId);
    if (idx <= 0) return textures;
    const head = textures[idx];
    return [head, ...textures.slice(0, idx), ...textures.slice(idx + 1)];
  }, [textures, activeTextureId]);

  return (
    <aside
      data-testid="texture-palette"
      className="pointer-events-auto absolute left-3 top-3 z-10 flex max-h-[min(560px,calc(100%-1.5rem))] w-[180px] flex-col overflow-hidden rounded-md border border-border bg-bg/85 backdrop-blur-sm shadow-lg"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-medium text-fg hover:bg-surface"
        aria-expanded={open}
      >
        <span>貼圖調色盤</span>
        <span aria-hidden className="text-muted">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="flex-1 overflow-y-auto p-2">
          {ordered.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-muted">尚無可用貼圖</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {ordered.map((t) => (
                <TextureTile
                  key={t.id}
                  texture={t}
                  active={t.id === activeTextureId}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function TextureTile({
  texture,
  active,
}: {
  texture: Texture;
  active: boolean;
}) {
  const url = textureUrl(texture);
  const label = texture.label ?? texture.filename ?? texture.id;

  return (
    <div
      draggable
      data-testid="texture-palette-tile"
      data-texture-id={texture.id}
      onDragStart={(e) => {
        e.dataTransfer.setData(TEXTURE_DRAG_MIME, texture.id);
        // `copy` makes the cursor show a + badge — clearer than the default
        // `move` which hints at removing the source tile.
        e.dataTransfer.effectAllowed = "copy";
        // Use the tile itself as the drag image so the cursor carries the
        // texture preview. Offset to roughly the middle so it looks pinned
        // to the cursor instead of trailing behind.
        const target = e.currentTarget as HTMLElement;
        e.dataTransfer.setDragImage(target, 30, 30);
      }}
      title={label}
      className={[
        "group relative h-[60px] w-[60px] cursor-grab overflow-hidden rounded border bg-surface transition-colors active:cursor-grabbing",
        active
          ? "border-accent ring-2 ring-accent/40"
          : "border-border hover:border-fg",
      ].join(" ")}
    >
      <img
        src={url}
        alt={label}
        // `pointer-events-none` so the wrapping div is the drag origin;
        // otherwise some browsers fire dragstart on the inner image and the
        // wrapper's data-texture-id never wins.
        className="pointer-events-none h-full w-full object-cover"
        draggable={false}
      />
      {active && (
        <span
          aria-label="使用中"
          className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent text-[9px] text-bg"
        >
          ✓
        </span>
      )}
    </div>
  );
}
