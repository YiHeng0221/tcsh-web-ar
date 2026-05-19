import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ObjectListItem } from "@/modes/b/components/ObjectListItem";
import { useViewerController } from "@/modes/b/components/ViewerContext";
import { useBLayout } from "@/modes/b/hooks/useMediaQuery";
import { useObjectsWithStations } from "@/modes/b/hooks/useObjects";
import type { ARObject } from "@/lib/api";

/**
 * B3 · Object Search (issue #20).
 *
 * Three responsive layouts driven by `useBLayout`:
 *   - mobile           → fullscreen sheet
 *   - tablet-portrait  → bottom sheet covering the bottom 80%
 *   - tablet-landscape → 480-px right-side panel, canvas keeps the rest
 *
 * Selecting a result asks B2's `ViewerController` to fly to that object;
 * if there's no controller (e.g. someone deep-linked /b/search before B2
 * mounted) we navigate back to /b — B2 will mount and the user can search
 * again from there.
 */
type Props = {
  /**
   * Called by the host (B2Viewer) to dismiss the overlay. When the screen
   * is reached as a standalone route, omit this and we'll fall back to
   * `navigate(-1)`.
   */
  onClose?: () => void;
};

export default function B3Search({ onClose }: Props = {}) {
  const layout = useBLayout();
  const navigate = useNavigate();
  const controller = useViewerController();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  const { objects, stationByObjectId, isLoading, error } =
    useObjectsWithStations();

  // Filter is over `物件 042` codes (1-based ordinal), labels, and the
  // raw uuid prefix so power-users can paste an id. Case-insensitive.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const indexed = objects.map((o, i) => ({ object: o, index: i }));
    if (!q) return indexed;
    return indexed.filter(({ object, index }) => {
      const code = String(index + 1).padStart(3, "0");
      const label = object.label?.toLowerCase() ?? "";
      const id = object.id.toLowerCase();
      return (
        code.includes(q) ||
        label.includes(q) ||
        id.startsWith(q) ||
        `物件 ${code}`.toLowerCase().includes(q)
      );
    });
  }, [objects, query]);

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

  // Auto-focus the input on mount; the on-screen keyboard popping up is
  // expected for a search overlay. Skip the autofocus on tablet-landscape
  // so the canvas isn't immediately covered by the iPad software keyboard
  // when the panel docks open.
  useEffect(() => {
    if (layout === "tablet-landscape") return;
    inputRef.current?.focus();
  }, [layout]);

  // Esc dismisses on every layout — overlay convention. `handleClose` is
  // stabilised via `useCallback` above so this listener doesn't churn on
  // every keystroke but still picks up onClose/navigate identity changes.
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

  const body = (
    <SearchBody
      layout={layout}
      query={query}
      onQuery={setQuery}
      results={filtered}
      stationByObjectId={stationByObjectId}
      isLoading={isLoading}
      error={error}
      onSelect={handleSelect}
      onClose={handleClose}
      inputRef={inputRef}
    />
  );

  // Render a layout-specific shell. All three share `body`; the wrapper
  // controls position, backdrop, and dismissal affordance.
  if (layout === "tablet-landscape") {
    return (
      <aside
        role="dialog"
        aria-modal="false"
        aria-label="搜尋物件"
        className="absolute inset-y-0 right-0 z-30 flex w-[480px] flex-col bg-white text-a1-ink shadow-[-4px_0_16px_rgba(0,0,0,0.3)]"
      >
        {body}
      </aside>
    );
  }

  if (layout === "tablet-portrait") {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="搜尋物件"
        className="absolute inset-0 z-30 flex flex-col justify-end"
      >
        <button
          type="button"
          aria-label="關閉搜尋"
          onClick={handleClose}
          // Tap-anywhere-above-sheet to dismiss. Plain `<button>` over
          // 20% of the screen with full opacity 0 works for both pointer
          // and screen-reader users (announced as "關閉搜尋").
          className="h-[20%] w-full bg-black/40"
        />
        <section className="flex h-[80%] flex-col rounded-t-sheet bg-white text-a1-ink">
          <SheetHandle />
          {body}
        </section>
      </div>
    );
  }

  // mobile
  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label="搜尋物件"
      className="absolute inset-0 z-30 flex flex-col bg-white text-a1-ink"
    >
      {body}
    </section>
  );
}

// ── Body ────────────────────────────────────────────────────────────────
type BodyProps = {
  layout: ReturnType<typeof useBLayout>;
  query: string;
  onQuery: (v: string) => void;
  results: { object: ARObject; index: number }[];
  stationByObjectId: Map<string, string>;
  isLoading: boolean;
  error: unknown;
  onSelect: (o: ARObject) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
};

function SearchBody({
  layout,
  query,
  onQuery,
  results,
  stationByObjectId,
  isLoading,
  error,
  onSelect,
  onClose,
  inputRef,
}: BodyProps) {
  return (
    <>
      <header className="safe-area flex items-center gap-3 px-4 pt-4 pb-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉"
          data-testid="mode-b-overlay-close"
          className="flex h-10 w-10 items-center justify-center text-2xl leading-none text-a1-ink"
        >
          ✕
        </button>
        {layout === "tablet-landscape" && (
          <h2 className="text-lg font-medium">搜尋物件</h2>
        )}
      </header>

      <div className="px-4 pb-3">
        <div className="flex h-12 items-center gap-3 rounded-full bg-a1-hairline px-5">
          <span aria-hidden className="text-base text-a1-caption">
            🔍
          </span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="搜尋物件名稱或編號"
            // Disable iOS's auto-corrections so a code like "042" or a
            // raw label doesn't get autocorrected mid-typing.
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-label="搜尋物件名稱或編號"
            data-testid="mode-b-search-input"
            className="flex-1 bg-transparent text-base text-a1-ink placeholder:text-a1-caption focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="清除搜尋"
              data-testid="mode-b-search-clear"
              className="text-sm text-a1-caption hover:text-a1-ink"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <Results
          results={results}
          stationByObjectId={stationByObjectId}
          isLoading={isLoading}
          error={error}
          query={query}
          onSelect={onSelect}
        />
      </div>
    </>
  );
}

// ── Results states ──────────────────────────────────────────────────────
function Results({
  results,
  stationByObjectId,
  isLoading,
  error,
  query,
  onSelect,
}: {
  results: { object: ARObject; index: number }[];
  stationByObjectId: Map<string, string>;
  isLoading: boolean;
  error: unknown;
  query: string;
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
  if (results.length === 0) {
    return (
      <StateBlock>
        <p className="text-sm text-a1-ink-soft">
          {query ? `找不到符合「${query}」的物件` : "尚未建立物件"}
        </p>
        {query && (
          <p className="text-xs text-a1-caption">
            試試物件編號（例如 042）或名稱關鍵字
          </p>
        )}
      </StateBlock>
    );
  }

  return (
    <ul className="divide-y divide-a1-hairline">
      {results.map(({ object, index }) => (
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

function SheetHandle() {
  return (
    <div className="flex h-5 w-full shrink-0 items-center justify-center">
      <span
        aria-hidden
        className="h-1 w-10 rounded-full bg-a1-hairline"
      />
    </div>
  );
}
