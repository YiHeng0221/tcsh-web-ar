import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ObjectListItem } from "@/modes/b/components/ObjectListItem";
import { useViewerController } from "@/modes/b/components/ViewerContext";
import { useBLayout } from "@/modes/b/hooks/useMediaQuery";
import { useObjectsWithStations } from "@/modes/b/hooks/useObjects";
import type { ARObject } from "@/lib/api";

/**
 * B4 · Object List (issue #21).
 *
 * Full inventory of artwork objects. Mobile / tablet-portrait render a
 * single column; tablet-landscape renders a 2-column grid. Real
 * leading-letter section grouping (matching the Figma "A" pill) is
 * deferred until the backend ships a `short_code` field — the prior
 * hard-coded "A" chip was misleading because the list isn't actually
 * grouped. See PR #62 AI review (MINOR #5).
 *
 * Selection delegates to the same `ViewerController` as B3 — picking an
 * object flies the camera and dismisses the list overlay.
 */
type SortMode = "code" | "label" | "station";

type Props = {
  onClose?: () => void;
};

export default function B4List({ onClose }: Props = {}) {
  const layout = useBLayout();
  const navigate = useNavigate();
  const controller = useViewerController();
  const [sortMode, setSortMode] = useState<SortMode>("code");

  const { objects, stationByObjectId, isLoading, error } =
    useObjectsWithStations();

  // Keep each row's index stable to its sort position so the "物件 042"
  // ordinal stays consistent within a sort. Switching sort orders does
  // re-number; that's intentional (the ordinal is a UI affordance, not
  // an identifier).
  const sorted = useMemo(() => {
    const indexed = objects.map((o) => ({ object: o }));
    const collator = new Intl.Collator("zh-Hant", { sensitivity: "base" });
    if (sortMode === "label") {
      indexed.sort((a, b) => collator.compare(a.object.label, b.object.label));
    } else if (sortMode === "station") {
      indexed.sort((a, b) => {
        const sa = stationByObjectId.get(a.object.id) ?? "";
        const sb = stationByObjectId.get(b.object.id) ?? "";
        return collator.compare(sa, sb);
      });
    }
    // "code" mode keeps backend order, which is created_at-ish.
    return indexed.map(({ object }, index) => ({ object, index }));
  }, [objects, sortMode, stationByObjectId]);

  const handleClose = useCallback(() => {
    if (onClose) onClose();
    else if (window.history.length > 1) navigate(-1);
    else navigate("/b", { replace: true });
  }, [onClose, navigate]);

  const handleSelect = useCallback(
    (object: ARObject) => {
      controller?.flyToObject(object);
      handleClose();
    },
    [controller, handleClose],
  );

  // Esc closes — same convention as B3. `handleClose` is stabilised via
  // `useCallback` above so we can safely include it in deps.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const totalLabel = `${sorted.length} 項`;
  const isTwoColumn = layout === "tablet-landscape";

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label="全部物件"
      className="absolute inset-0 z-30 flex flex-col bg-white text-a1-ink"
    >
      <Header
        layout={layout}
        totalLabel={totalLabel}
        sortMode={sortMode}
        onSortChange={setSortMode}
        onClose={handleClose}
      />

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <ListBody
          sorted={sorted}
          stationByObjectId={stationByObjectId}
          isLoading={isLoading}
          error={error}
          isTwoColumn={isTwoColumn}
          onSelect={handleSelect}
        />
      </div>
    </section>
  );
}

// ── Header ──────────────────────────────────────────────────────────────
function Header({
  layout,
  totalLabel,
  sortMode,
  onSortChange,
  onClose,
}: {
  layout: ReturnType<typeof useBLayout>;
  totalLabel: string;
  sortMode: SortMode;
  onSortChange: (m: SortMode) => void;
  onClose: () => void;
}) {
  // Mobile centres the title block under the close button; tablet
  // landscape lifts the title to the row's vertical centre to match the
  // mockup spacing.
  const isWide = layout !== "mobile";
  return (
    <header className="safe-area relative flex items-center justify-between px-4 pt-4 pb-3">
      <button
        type="button"
        onClick={onClose}
        aria-label="關閉"
        data-testid="mode-b-overlay-close"
        className="flex h-10 w-10 items-center justify-center text-2xl leading-none text-a1-ink"
      >
        ✕
      </button>

      <div
        className={
          isWide
            ? "flex flex-col items-center"
            : "absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
        }
      >
        <h2 className="text-base font-medium">全部物件</h2>
        <p className="text-xs text-a1-caption">{totalLabel}</p>
      </div>

      <SortMenu mode={sortMode} onChange={onSortChange} />
    </header>
  );
}

// ── Sort menu ───────────────────────────────────────────────────────────
function SortMenu({
  mode,
  onChange,
}: {
  mode: SortMode;
  onChange: (m: SortMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside dismissal. Pointerdown so the menu closes before a
  // tap on the underlying list lands — feels snappier than a click
  // listener that races with the row's own click handler.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const labelByMode: Record<SortMode, string> = {
    code: "編號",
    label: "名稱",
    station: "站點",
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="mode-b-list-sort-toggle"
        className="flex h-10 items-center gap-1 px-2 text-sm text-a1-ink"
      >
        排序<span aria-hidden className="text-xs text-a1-caption">▼</span>
      </button>
      {open && (
        <ul
          role="menu"
          className="absolute right-0 top-11 z-10 w-32 overflow-hidden rounded-card border border-a1-hairline bg-white shadow-lg"
        >
          {(Object.keys(labelByMode) as SortMode[]).map((m) => (
            <li key={m} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={m === mode}
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
                data-testid={`mode-b-list-sort-${m}`}
                className={
                  "block w-full px-4 py-2.5 text-left text-sm hover:bg-black/[0.03] " +
                  (m === mode ? "font-medium text-a1-ink" : "text-a1-ink-soft")
                }
              >
                {labelByMode[m]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── List body ───────────────────────────────────────────────────────────
function ListBody({
  sorted,
  stationByObjectId,
  isLoading,
  error,
  isTwoColumn,
  onSelect,
}: {
  sorted: { object: ARObject; index: number }[];
  stationByObjectId: Map<string, string>;
  isLoading: boolean;
  error: unknown;
  isTwoColumn: boolean;
  onSelect: (o: ARObject) => void;
}) {
  if (isLoading) {
    return (
      <StateBlock>
        <p className="text-sm text-a1-caption">載入物件中…</p>
      </StateBlock>
    );
  }
  if (error) {
    return (
      <StateBlock>
        <p className="text-sm text-danger">無法載入物件清單</p>
        <p className="text-xs text-a1-caption">請檢查網路後再試一次</p>
      </StateBlock>
    );
  }
  if (sorted.length === 0) {
    return (
      <StateBlock>
        <p className="text-sm text-a1-ink-soft">尚未建立物件</p>
        <p className="text-xs text-a1-caption">
          請管理員在 Mode C 新增 AR 物件
        </p>
      </StateBlock>
    );
  }

  if (isTwoColumn) {
    return (
      <div className="grid grid-cols-2 gap-3 px-4 pb-8">
        {sorted.map(({ object, index }) => (
          <ObjectListItem
            key={object.id}
            object={object}
            index={index}
            stationLabel={stationByObjectId.get(object.id)}
            onSelect={onSelect}
            variant="card"
          />
        ))}
      </div>
    );
  }

  // Single-column layout. The Figma shows a section pill ("A") above the
  // list, but the underlying data isn't actually grouped — the old code
  // hard-coded the pill which would have shown the same "A" label
  // regardless of sort mode or content. Pill is removed until a backend
  // `short_code` makes real grouping meaningful. See PR #62 AI review
  // (MINOR #5).
  return (
    <ul className="divide-y divide-a1-hairline">
      {sorted.map(({ object, index }) => (
        <li key={object.id}>
          <ObjectListItem
            object={object}
            index={index}
            stationLabel={stationByObjectId.get(object.id)}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
  );
}

function StateBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-1.5 px-6 py-12 text-center">
      {children}
    </div>
  );
}
