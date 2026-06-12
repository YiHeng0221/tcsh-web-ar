import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiGet } from "@/lib/api/client";
import type { Placement } from "@/lib/api";
import { cn } from "@/lib/cn";
import AdminShell from "@/modes/c/components/AdminShell";
import { textureUrl, type Texture } from "@/modes/c/lib/textureApi";
import C4UploadDialog from "@/modes/c/screens/C4UploadDialog";

/**
 * C3 · Texture Library (issue #26).
 *
 * 7-column thumbnail grid (160×160 each). Each tile shows the texture's
 * label / filename and a teal "已指派" checkmark badge if at least one
 * placement references it. C4 (upload dialog) is mounted here as a modal
 * — opened by the "+ 上傳新貼圖" action in the top nav.
 *
 * Data sources:
 *   - `GET /textures`   — canonical texture list. Each tile renders the
 *                         binary directly via `${VITE_API_BASE_URL}${file_url}`.
 *   - `GET /placements` — only used to compute the "assigned" badge by
 *                         tallying which `texture_id`s are referenced.
 *
 * Migration note (2026-04): the previous implementation derived a fake
 * texture list from the placements list (no `/textures` endpoint shipped
 * yet). The endpoint exists now, so this is the real thing.
 */

type Filter = "all" | "assigned" | "unassigned";

/** Internal view-model — wraps a real Texture with the derived `assigned`
 *  flag so the grid renderer doesn't need to know about placements. */
type TextureView = Texture & { assigned: boolean };

export default function C3TextureLibrary() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [uploadOpen, setUploadOpen] = useState(false);

  const texturesQ = useQuery({
    queryKey: ["textures"],
    queryFn: ({ signal }) => apiGet<Texture[]>("/textures", { signal }),
  });
  const placementsQ = useQuery({
    queryKey: ["c", "placements"],
    queryFn: ({ signal }) => apiGet<Placement[]>("/placements", { signal }),
  });

  const textures = useMemo<TextureView[]>(() => {
    const list = texturesQ.data ?? [];
    const placements = placementsQ.data ?? [];
    const assigned = new Set<string>();
    for (const p of placements) {
      if (p.texture_id) assigned.add(p.texture_id);
    }
    return list.map((t) => ({ ...t, assigned: assigned.has(t.id) }));
  }, [texturesQ.data, placementsQ.data]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return textures.filter((t) => {
      if (filter === "assigned" && !t.assigned) return false;
      if (filter === "unassigned" && t.assigned) return false;
      if (q) {
        const haystack = [t.label ?? "", t.filename, t.id]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [textures, search, filter]);

  // Loading once if either request is still pending. Errors are reported
  // via the textures query first — placements is a nice-to-have for the
  // assigned badge, so we keep the grid usable even if it fails.
  const isLoading = texturesQ.isLoading;
  const isError = texturesQ.isError;

  return (
    <AdminShell
      variant="back"
      title="貼圖庫"
      actions={
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-medium text-c-ink hover:bg-accent-strong"
        >
          <span aria-hidden>+</span>
          上傳新貼圖
        </button>
      }
      contentClassName="px-10 py-6"
    >
      {/* Search + filter bar */}
      <div className="flex items-center justify-between">
        <label className="relative flex items-center">
          <span aria-hidden className="absolute left-3 text-c-muted">
            🔍
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋…"
            className="h-9 w-64 rounded-md border border-c-hairline bg-c-surface pl-9 pr-3 text-sm placeholder:text-c-placeholder focus:border-c-ink focus:outline-none"
          />
        </label>

        <FilterDropdown value={filter} onChange={setFilter} />
      </div>

      {/* Grid */}
      <section className="mt-5">
        {isLoading ? (
          <SkeletonGrid />
        ) : isError ? (
          <p className="rounded-md border border-c-hairline bg-c-surface p-8 text-center text-sm text-danger">
            無法載入貼圖庫（API 連線失敗）
          </p>
        ) : visible.length === 0 ? (
          <EmptyGrid empty={textures.length === 0} />
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
          >
            {visible.map((t) => (
              <TextureTile key={t.id} texture={t} />
            ))}
          </div>
        )}
      </section>

      <C4UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </AdminShell>
  );
}

// ── Tile ─────────────────────────────────────────────────────────────────

function TextureTile({ texture }: { texture: TextureView }) {
  const url = textureUrl(texture);
  const label = texture.label || texture.filename || texture.id;

  return (
    <button
      type="button"
      className="group relative aspect-square w-full overflow-hidden rounded-md border border-c-hairline bg-c-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      title={label}
    >
      <img
        src={url}
        alt={label}
        // `loading="lazy"` so a library of 200+ textures doesn't all hit
        // the network on first render. `decoding="async"` keeps the main
        // thread free during the initial paint of the grid.
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
      <span className="absolute bottom-1.5 left-2 max-w-[80%] truncate rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-white/95">
        {shortLabel(label)}
      </span>
      {texture.assigned && (
        <span
          className="absolute bottom-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] text-c-ink"
          aria-label="已指派"
        >
          ✓
        </span>
      )}
    </button>
  );
}

function SkeletonGrid() {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
    >
      {Array.from({ length: 14 }).map((_, i) => (
        <div
          key={i}
          className="aspect-square w-full animate-pulse rounded-md bg-c-hairline"
        />
      ))}
    </div>
  );
}

function EmptyGrid({ empty }: { empty: boolean }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center rounded-md border border-dashed border-c-hairline-strong bg-c-surface text-sm text-c-muted">
      <p>{empty ? "尚未上傳任何貼圖" : "沒有符合條件的貼圖"}</p>
      <p className="mt-1 text-xs">點擊右上角「+ 上傳新貼圖」開始</p>
    </div>
  );
}

// ── Filter dropdown ──────────────────────────────────────────────────────

function FilterDropdown({
  value,
  onChange,
}: {
  value: Filter;
  onChange: (v: Filter) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-c-muted">
      篩選：
      <span className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as Filter)}
          className={cn(
            "h-8 appearance-none rounded-md border border-transparent bg-transparent py-0 pl-1 pr-5 text-sm text-c-ink",
            "focus:border-c-hairline focus:outline-none",
          )}
        >
          <option value="all">全部</option>
          <option value="assigned">已指派</option>
          <option value="unassigned">未指派</option>
        </select>
        <span aria-hidden className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-c-muted">
          ▾
        </span>
      </span>
    </label>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Trim very long labels so the bottom-left badge stays readable. */
function shortLabel(label: string): string {
  if (label.length <= 18) return label;
  return `${label.slice(0, 15)}…`;
}
