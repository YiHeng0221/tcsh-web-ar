import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

import A1Permission from "@/modes/a/screens/A1Permission";
import A2StationPicker from "@/modes/a/screens/A2StationPicker";
import ModeCRoot from "@/modes/c/ModeCRoot";
import Landing from "@/pages/Landing";
import NotFound from "@/pages/NotFound";

// Lazy-load the 3D viewer so three + drei + the artwork's preload call
// only land when a visitor actually navigates to /b. Otherwise Landing
// and Mode A eat the ~1 MB three.js bundle plus a ~10 MB glTF preload
// for no reason.
const B2Viewer = lazy(() => import("@/modes/b/screens/B2Viewer"));

// Lazy-load the AR view so the whole tracking stack — zxing QR reader, the
// three.js render layer, and (dynamically, one level deeper) the ~8 MB OpenCV
// WASM — stays out of the main bundle. A visitor on Landing or in Mode B must
// never pay for it; only a deep-link into /a/scan|/a/view pulls this chunk.
const ARView = lazy(() => import("@/modes/a/screens/ARView"));

// Dev-only sandbox for eyeballing the Mode A mock placements without a
// camera. Lazy for the same three.js-bundle reason as B2. Dev-only by
// convention (not env-gated): it ships nothing beyond the shared 3D
// chunk and six small demo textures, and having it in prod builds lets
// field testers compare expected vs AR layout on the same device.
const DevMockPlacements = lazy(() => import("@/pages/DevMockPlacements"));

// Dev-only spike for 8th Wall SLAM walking-AR. Lazy + a runtime-injected
// engine <script> (see lib/slam/load-xr8.ts) keep the ~1 MB SLAM binary out
// of every other route's bundle — only a deep-link into /dev/slam-mvp pulls
// it, and only after the user taps Start.
const DevSlamMvp = lazy(() => import("@/pages/DevSlamMvp"));

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

  // Mode A · flow (spec §0.5): a floor QR deep-links straight into the AR
  // view. A3 (scan) + A4 (viewing) are merged into one ARView screen with an
  // internal state machine — both /a/scan/:id and /a/view/:id resolve to it so
  // already-printed QRs and old links keep working. A1 (permission) stays as
  // the legacy entry; A2 (stations) is now a "no-QR" fallback, not the main
  // path. A5/A6 land as overlays on ARView later (#15 / #16).
  { path: "/a", element: <Navigate to="/a/permission" replace /> },
  { path: "/a/permission", element: <A1Permission /> },
  { path: "/a/stations", element: <A2StationPicker /> },
  {
    path: "/a/scan/:stationId",
    element: (
      <Suspense fallback={<LazyChunkLoading />}>
        <ARView />
      </Suspense>
    ),
  },
  {
    path: "/a/view/:stationId",
    element: (
      <Suspense fallback={<LazyChunkLoading />}>
        <ARView />
      </Suspense>
    ),
  },

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

  // Dev sandbox: mock placement layout viewer (see component docstring).
  {
    path: "/dev/mock-placements",
    element: (
      <Suspense fallback={<LazyChunkLoading />}>
        <DevMockPlacements />
      </Suspense>
    ),
  },

  // Dev spike: 8th Wall SLAM walking-AR MVP (see component docstring).
  {
    path: "/dev/slam-mvp",
    element: (
      <Suspense fallback={<LazyChunkLoading />}>
        <DevSlamMvp />
      </Suspense>
    ),
  },

  // Mode C lives at /_studio/:token/* — the splat lets ModeCRoot mount
  // its own sub-router for C1 login + C2/C3/C5 admin screens.
  { path: "/_studio/:token/*", element: <ModeCRoot /> },
  { path: "/_studio", element: <Navigate to="/" replace /> },

  { path: "*", element: <NotFound /> },
]);
