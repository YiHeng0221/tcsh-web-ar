/**
 * ARViewWithFallback — picks the Mode A AR path at runtime (spec §0, §4).
 *
 * SLAM is the main line: `ARViewSlam` (8th Wall walking-AR). But the engine
 * binary is a runtime-injected `<script>` from a CDN, and some older devices /
 * blocked CDNs can't load it. Rather than dead-end those visitors, we probe
 * `loadXR8()` once up front:
 *
 *   - resolves → render `ARViewSlam` (the full SLAM experience).
 *   - rejects  → fall back to the legacy QR + IMU `ARView`, with a discreet
 *     「精簡模式」 badge so the visitor knows they're on the lighter path.
 *
 * The probe is cheap on success (the script is cached and the same promise is
 * reused by `ARViewSlam`'s own `loadXR8()` call — `load-xr8.ts` memoises it),
 * and on failure it surfaces quickly via the script's `onerror`. Keeping the
 * decision here (not in the router) means the router stays a single lazy
 * import and the fallback UX lives next to the screens it chooses between.
 */

import { useEffect, useState } from "react";

import { loadXR8 } from "@/lib/slam/load-xr8";

import ARView from "./ARView";
import ARViewSlam from "./ARViewSlam";

type Decision = "probing" | "slam" | "fallback";

export default function ARViewWithFallback() {
  const [decision, setDecision] = useState<Decision>("probing");

  useEffect(() => {
    let cancelled = false;
    loadXR8().then(
      () => {
        if (!cancelled) setDecision("slam");
      },
      () => {
        if (!cancelled) setDecision("fallback");
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (decision === "probing") {
    return (
      <main className="safe-area flex h-dvh w-screen flex-col items-center justify-center bg-black text-sm text-white/70">
        準備 AR 引擎…
      </main>
    );
  }

  if (decision === "fallback") {
    return (
      <div className="relative h-dvh w-screen">
        <ARView />
        {/* The badge sits over the legacy screen's own overlay; it's purely
            informational and never intercepts touch. */}
        <div className="safe-area pointer-events-none absolute inset-x-0 bottom-0 z-[10001] flex justify-center px-4 pb-4">
          <span className="rounded-full bg-amber-500/85 px-3 py-1 text-xs font-medium text-black">
            精簡模式
          </span>
        </div>
      </div>
    );
  }

  return <ARViewSlam />;
}
