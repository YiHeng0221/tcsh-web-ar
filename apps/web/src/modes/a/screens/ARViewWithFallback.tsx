/**
 * ARViewWithFallback — gates Mode A behind the SLAM engine probe (spec §0).
 *
 * SLAM is the ONLY line (user decision 2026-06-13 05:29: no IMU fallback —
 * one tracking behaviour everywhere, simpler to reason about in the field).
 * The engine binary is a runtime-injected `<script>` from a CDN; if a device
 * or network can't load it we show an honest "unsupported" prompt instead of
 * silently degrading to a different tracking model.
 *
 * The probe is cheap on success (the script is cached and the same promise is
 * reused by `ARViewSlam`'s own `loadXR8()` call — `load-xr8.ts` memoises it),
 * and on failure it surfaces quickly via the script's `onerror`.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { loadXR8 } from "@/lib/slam/load-xr8";

import ARViewSlam from "./ARViewSlam";

type Decision = "probing" | "slam" | "unsupported";

export default function ARViewWithFallback() {
  const [decision, setDecision] = useState<Decision>("probing");

  const probe = useCallback(() => {
    setDecision("probing");
    let cancelled = false;
    loadXR8().then(
      () => {
        if (!cancelled) setDecision("slam");
      },
      () => {
        if (!cancelled) setDecision("unsupported");
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => probe(), [probe]);

  if (decision === "probing") {
    return (
      <main className="safe-area flex h-dvh w-screen flex-col items-center justify-center bg-black text-sm text-white/70">
        準備 AR 引擎…
      </main>
    );
  }

  if (decision === "unsupported") {
    return (
      <main className="safe-area flex h-dvh w-screen flex-col items-center justify-center gap-6 bg-black px-8 text-center text-white">
        <h1 className="text-xl font-medium">這台裝置暫時無法使用 AR</h1>
        <p className="max-w-xs text-sm text-white/70">
          AR 引擎載入失敗——可能是裝置過舊、瀏覽器不支援，或目前的網路擋住了
          引擎下載。你仍然可以用 3D 模式欣賞完整作品。
        </p>
        <div className="flex flex-col items-center gap-3">
          <Link
            to="/b"
            className="rounded-xl bg-accent px-8 py-3 text-base font-semibold text-black"
          >
            改用 3D 模式
          </Link>
          <button
            type="button"
            onClick={probe}
            className="text-sm text-white/60 underline-offset-4 hover:underline"
          >
            重試 AR
          </button>
        </div>
      </main>
    );
  }

  return <ARViewSlam />;
}
