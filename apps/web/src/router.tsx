import { createBrowserRouter, Navigate } from "react-router-dom";

import Landing from "@/pages/Landing";
import NotFound from "@/pages/NotFound";
import ModeARoot from "@/modes/a/ModeARoot";
import ModeBRoot from "@/modes/b/ModeBRoot";
import ModeCRoot from "@/modes/c/ModeCRoot";

export const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/a", element: <ModeARoot /> },
  { path: "/b", element: <ModeBRoot /> },
  // Mode C lives under an obfuscated token path (issue #23 adds the real
  // gating). Until then, any non-empty token forwards to the shell.
  { path: "/_studio/:token", element: <ModeCRoot /> },
  { path: "/_studio", element: <Navigate to="/" replace /> },
  // Any other path renders a NotFound page that shows the original
  // pathname, so typos / stale share links are debuggable instead of being
  // silently swallowed by a redirect to `/`.
  { path: "*", element: <NotFound /> },
]);
