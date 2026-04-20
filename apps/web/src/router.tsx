import { createBrowserRouter, Navigate } from "react-router-dom";

import A1Permission from "@/modes/a/screens/A1Permission";
import A2StationPicker from "@/modes/a/screens/A2StationPicker";
import A3QRScan from "@/modes/a/screens/A3QRScan";
import A4ARViewing from "@/modes/a/screens/A4ARViewing";
import ModeBRoot from "@/modes/b/ModeBRoot";
import ModeCRoot from "@/modes/c/ModeCRoot";
import Landing from "@/pages/Landing";
import NotFound from "@/pages/NotFound";

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

  // Mode B / Mode C shells still on their own. Internal routing lands
  // with the mode-specific issues (#18–#22, #23–#29).
  { path: "/b", element: <ModeBRoot /> },
  { path: "/_studio/:token", element: <ModeCRoot /> },
  { path: "/_studio", element: <Navigate to="/" replace /> },

  { path: "*", element: <NotFound /> },
]);
