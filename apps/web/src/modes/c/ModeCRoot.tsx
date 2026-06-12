import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";

import C1Login from "@/modes/c/screens/C1Login";
import C2Dashboard from "@/modes/c/screens/C2Dashboard";
import C3TextureLibrary from "@/modes/c/screens/C3TextureLibrary";
import { useAuthSession } from "@/modes/c/lib/auth";

/**
 * Mode C entry — creator admin sub-router.
 *
 * Top-level router mounts this at `/_studio/:token/*` (note the splat).
 * Path token is obscurity, not security: every mutating call still verifies
 * a local-issued JWT server-side (see `apps/api/src/tcsh_ar_api/auth`).
 *
 * Auth gating:
 *   - `loading`         → minimal splash so we don't flash C1 on refresh.
 *   - `unauthenticated` → C1Login.
 *   - `authenticated`   → C2-C6 sub-routes.
 *
 * Route layout (relative to /_studio/:token):
 *   ""                         → C2 Dashboard
 *   "textures"                 → C3 Texture Library
 *   "placements"               → C5 Placement Editor (placeholder list)
 *   "placements/:placementId"  → C5 Placement Editor (selected)
 *   "anchors"                  → reuses C5 until the dedicated screen ships
 */

// Lazy-loaded so the placement editor's R3F + drei chunk doesn't ride
// along with the dashboard / library chunks.
const C5PlacementEditor = lazy(() => import("@/modes/c/screens/C5PlacementEditor"));

export default function ModeCRoot() {
  const { status } = useAuthSession();
  const { token } = useParams<{ token: string }>();

  if (status === "loading") return <AuthSplash />;
  if (status === "unauthenticated") {
    // Render C1 directly rather than nav-redirecting — this keeps the URL
    // (`/_studio/:token/...`) intact so a successful login lands the user
    // back on whatever sub-route they originally requested.
    return <C1Login />;
  }

  // Authenticated. The top-level route binds us at `/_studio/:token/*`,
  // so nested `<Routes>` matches the splat suffix.
  return (
    <Suspense fallback={<AuthSplash />}>
      <Routes>
        <Route index element={<C2Dashboard />} />
        <Route path="textures" element={<C3TextureLibrary />} />
        <Route path="placements" element={<C5PlacementEditor />} />
        <Route path="placements/:placementId" element={<C5PlacementEditor />} />
        <Route path="anchors" element={<C5PlacementEditor />} />
        <Route
          path="*"
          element={<Navigate to={`/_studio/${token ?? ""}`} replace />}
        />
      </Routes>
    </Suspense>
  );
}

function AuthSplash() {
  return (
    <div
      data-mode="c"
      className="flex min-h-dvh items-center justify-center bg-c-bg text-sm text-c-muted"
    >
      載入中…
    </div>
  );
}
