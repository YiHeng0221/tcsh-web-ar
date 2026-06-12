import { describe, expect, it } from "vitest";

import {
  REALIGN_ACCEPT_REPROJ_PX,
  RealignGuard,
} from "../realign";

describe("RealignGuard", () => {
  it("accepts the first solve unconditionally (no history to baseline)", () => {
    const guard = new RealignGuard();
    const d = guard.offer(1.5);
    expect(d.accept).toBe(true);
    expect(d.reason).toBeNull();
  });

  it("rejects a solve above the accept threshold without counting it as an outlier run", () => {
    const guard = new RealignGuard();
    guard.offer(1.0); // baseline
    const d = guard.offer(REALIGN_ACCEPT_REPROJ_PX + 0.1);
    expect(d.accept).toBe(false);
    expect(d.reason).toBe("above-threshold");
    // An above-threshold solve must NOT advance the jitter outlier run, so a
    // following clean solve is still accepted immediately.
    expect(guard.offer(1.1).accept).toBe(true);
  });

  it("drops the first two jitter outliers, then force-accepts the third (re-baseline)", () => {
    const guard = new RealignGuard();
    // Build a low-median history (all ~1px, under the 8px ceiling).
    for (let i = 0; i < 4; i++) expect(guard.offer(1.0).accept).toBe(true);

    // 3px is > 2× median(1) = 2, AND ≤ 8px ceiling → jitter outlier.
    const a = guard.offer(3.0);
    const b = guard.offer(3.0);
    const c = guard.offer(3.0);
    expect(a).toEqual({ accept: false, reason: "jitter-outlier" });
    expect(b).toEqual({ accept: false, reason: "jitter-outlier" });
    expect(c.accept).toBe(true); // 3rd consecutive → scene changed, accept
    expect(c.reason).toBeNull();
  });

  it("resets the outlier run when a clean solve lands between outliers", () => {
    const guard = new RealignGuard();
    for (let i = 0; i < 4; i++) guard.offer(1.0);

    expect(guard.offer(3.0).accept).toBe(false); // outlier #1
    expect(guard.offer(1.0).accept).toBe(true); // clean → resets run
    expect(guard.offer(3.0).accept).toBe(false); // outlier #1 again (not #2)
    expect(guard.offer(3.0).accept).toBe(false); // outlier #2
  });

  it("does not let dropped outliers poison the median history", () => {
    const guard = new RealignGuard();
    for (let i = 0; i < 5; i++) guard.offer(1.0);
    // Two dropped outliers...
    guard.offer(3.0);
    guard.offer(3.0);
    // ...then a clean 1.5px solve: median is still ~1 (drops weren't recorded),
    // and 1.5 ≤ 2× median, so it's accepted as a normal solve.
    const d = guard.offer(1.5);
    expect(d.accept).toBe(true);
    expect(d.reason).toBeNull();
  });

  it("seed() records the first lock so viewing has a median from frame one", () => {
    const guard = new RealignGuard();
    guard.seed(1.0); // first lock recorded
    // Now a 3px solve (> 2× median(1)) is a jitter outlier from the very first
    // viewing frame — proving seed populated the history.
    expect(guard.offer(3.0)).toEqual({ accept: false, reason: "jitter-outlier" });
  });

  it("seed() ignores a first lock above the accept threshold", () => {
    const guard = new RealignGuard();
    guard.seed(REALIGN_ACCEPT_REPROJ_PX + 5); // too poor → not recorded
    // History is empty, so the next solve is treated as the fresh baseline.
    expect(guard.offer(1.0).accept).toBe(true);
  });

  it("reset() clears history so the next solve is a fresh baseline", () => {
    const guard = new RealignGuard();
    for (let i = 0; i < 4; i++) guard.offer(1.0);
    guard.reset();
    // After reset, a 5px solve (would've been a huge outlier before) is the
    // first solve again → trusted.
    expect(guard.offer(5.0).accept).toBe(true);
  });
});
