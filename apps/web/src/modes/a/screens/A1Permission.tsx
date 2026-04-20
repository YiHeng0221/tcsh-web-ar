import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  allGranted,
  requestAllArPermissions,
  type PermissionState,
} from "@/lib/ar/permissions";

/**
 * A1 · Permission — AR entrance gate (issue #11).
 *
 * Per the Figma (fileKey emJGaE6FrrLbe6083mYrJf, node 4:2) this is the one
 * intentionally light-themed screen in Mode A. The rest of the mode lives
 * in the dark AR palette; A1 is the onboarding moment before the camera
 * takes over.
 */
export default function A1Permission() {
  const navigate = useNavigate();
  const [state, setState] = useState<PermissionState>("idle");
  const [denied, setDenied] = useState<{
    camera: boolean;
    orientation: boolean;
  } | null>(null);

  async function handleStart() {
    setState("requesting");
    const result = await requestAllArPermissions();
    if (allGranted(result)) {
      setState("granted");
      navigate("/a/stations");
      return;
    }
    setState("denied");
    setDenied({
      camera: result.camera !== "granted",
      orientation: result.orientation !== "granted",
    });
  }

  return (
    <main
      data-mode="a"
      data-screen="a1"
      className="safe-area relative mx-auto flex min-h-dvh w-full max-w-md flex-col overflow-hidden bg-white text-[#1a1a1a]"
    >
      <div className="relative h-[36dvh] w-full shrink-0 overflow-hidden bg-[#2a2a2a]">
        <GridPattern />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[8rem] bg-gradient-to-b from-transparent to-white" />
      </div>

      <div className="flex flex-1 flex-col px-5 pt-6">
        <h1 className="text-center text-2xl font-medium">歡迎來到 tcsh 作品</h1>

        <section className="mt-7 rounded-2xl border border-[#eee] bg-white p-6">
          <p className="text-center text-[2rem] leading-none">📷</p>
          <h2 className="mt-4 text-center text-base font-medium">
            需要以下權限才能開始體驗
          </h2>
          <ul className="mt-5 space-y-1.5 text-sm text-[#333]">
            <li>✓ &nbsp;相機 — 疊加 AR 貼圖</li>
            <li>✓ &nbsp;方位 — 追蹤手機角度</li>
          </ul>

          <button
            type="button"
            onClick={handleStart}
            disabled={state === "requesting"}
            className="mt-5 h-12 w-full rounded-lg bg-black text-base font-medium text-white transition-opacity disabled:opacity-60"
          >
            {state === "requesting" ? "請求權限中…" : "開始體驗"}
          </button>

          {state === "denied" && denied && (
            <p className="mt-3 text-center text-xs text-danger">
              {denied.camera && "相機權限未授予。"}
              {denied.orientation && "方位權限未授予。"}
              請到瀏覽器設定允許後再試一次。
            </p>
          )}
        </section>

        <nav className="mt-auto pb-8 text-center text-sm text-[#666]">
          <Link to="#" className="hover:text-[#1a1a1a]">
            使用說明
          </Link>
          <span aria-hidden className="px-3">
            ·
          </span>
          <Link to="#" className="hover:text-[#1a1a1a]">
            關於
          </Link>
        </nav>
      </div>
    </main>
  );
}

/** Subtle grid background in the header band, matching the Figma. */
function GridPattern() {
  return (
    <svg
      aria-hidden
      className="absolute inset-0 h-full w-full opacity-40"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="a1-grid" width="42" height="40" patternUnits="userSpaceOnUse">
          <path
            d="M 42 0 L 0 0 0 40"
            fill="none"
            stroke="#555555"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#a1-grid)" />
    </svg>
  );
}
