import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

import A1Permission from "@/modes/a/screens/A1Permission";
import A2StationPicker from "@/modes/a/screens/A2StationPicker";
import A3QRScan from "@/modes/a/screens/A3QRScan";
import A4ARViewing from "@/modes/a/screens/A4ARViewing";
import ModeCRoot from "@/modes/c/ModeCRoot";
import Landing from "@/pages/Landing";
import NotFound from "@/pages/NotFound";

// Lazy-load the 3D viewer so three + drei + the artwork's preload call
// only land when a visitor actually navigates to /b. Otherwise Landing
// and Mode A eat the ~1 MB three.js bundle plus a ~10 MB glTF preload
// for no reason.
const B2Viewer = lazy(() => import("@/modes/b/screens/B2Viewer"));

/** Lightweight DOM-only fallback while the lazy chunk downloads. */
function LazyChunkLoading() {
  return (
    <main className="safe-area flex min-h-dvh flex-col items-center justify-center bg-bg text-sm text-muted">
      載入中…
    </main>
  );
}

export const router = createBrowserRouter([
  { path: "/", element: <Landing /> },

  // Mode A · flow: permission → stations → scan/:id → view/:id.
  // A5 (object drawer) and A6 (next-station guide) are overlays on A4,
  // not top-level routes; they'll be modal state within A4 (#15 / #16).
  { path: "/a", element: <Navigate to="/a/permission" replace /> },
  { path: "/a/permission", element: <A1Permission /> },
  { path: "/a/stations", element: <A2StationPicker /> },
  { path: "/a/scan/:stationId", element: <A3QRScan /> },
  { path: "/a/view/:stationId", element: <A4ARViewing /> },

  // Mode B · 3D viewer. B1 loading (#18), B3 search (#20), B4 list (#21)
  // land as sub-routes of /b; right now /b = B2 viewer directly.
  {
    path: "/b",
    element: (
      <Suspense fallback={<LazyChunkLoading />}>
        <B2Viewer />
      </Suspense>
    ),
  },

  { path: "/_studio/:token/*", element: <ModeCRoot /> },
  { path: "/_studio", element: <Navigate to="/" replace /> },

  { path: "*", element: <NotFound /> },
]);
