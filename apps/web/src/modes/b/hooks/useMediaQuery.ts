import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query and re-render when it flips.
 *
 * Used by B3 / B4 to pick between the three responsive layouts (mobile
 * fullscreen sheet, tablet portrait bottom sheet, tablet landscape side
 * panel) — Tailwind responsive classes alone can't drive structural
 * differences like "mount as a `<dialog>` vs as a side `<aside>`".
 *
 * SSR-safe: returns `false` on the first render when `window` is missing
 * (we're a Vite SPA so this only matters during tests).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    // Sync on mount in case the query changed between render and effect.
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/**
 * Mode B layout breakpoints. Mobile = phone in portrait; tablet portrait =
 * iPad-ish width with portrait orientation; tablet landscape = wide.
 *
 * Thresholds mirror the Figma artboards (390 / 834 portrait / 1194 landscape).
 * 768 catches the iPad portrait case; 1024 catches landscape on the same
 * device. Using `min-width` queries means CSS pixel widths, not device px.
 */
export type BLayout = "mobile" | "tablet-portrait" | "tablet-landscape";

export function useBLayout(): BLayout {
  const isTabletWide = useMediaQuery("(min-width: 1024px)");
  const isTablet = useMediaQuery("(min-width: 768px)");
  if (isTabletWide) return "tablet-landscape";
  if (isTablet) return "tablet-portrait";
  return "mobile";
}
