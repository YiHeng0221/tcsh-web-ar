import { describe, expect, it } from "vitest";

import {
  CLICK_MAX_MOVE_PX,
  CLICK_MAX_MS,
  classifyPointerGesture,
} from "../pointerGesture";

describe("classifyPointerGesture", () => {
  it("treats a still, quick press as a click", () => {
    expect(classifyPointerGesture(0, 0)).toBe("click");
    expect(classifyPointerGesture(2, 120)).toBe("click");
  });

  it("treats movement at/over the px threshold as a drag (orbit)", () => {
    expect(classifyPointerGesture(CLICK_MAX_MOVE_PX, 50)).toBe("drag");
    expect(classifyPointerGesture(CLICK_MAX_MOVE_PX + 10, 50)).toBe("drag");
  });

  it("treats a long press at/over the time threshold as a drag", () => {
    expect(classifyPointerGesture(1, CLICK_MAX_MS)).toBe("drag");
    expect(classifyPointerGesture(1, CLICK_MAX_MS + 100)).toBe("drag");
  });

  it("requires BOTH thresholds to be satisfied for a click", () => {
    // Just under both → click.
    expect(
      classifyPointerGesture(CLICK_MAX_MOVE_PX - 1, CLICK_MAX_MS - 1),
    ).toBe("click");
    // Under px but over time → drag.
    expect(classifyPointerGesture(1, CLICK_MAX_MS + 1)).toBe("drag");
    // Over px but under time → drag.
    expect(classifyPointerGesture(CLICK_MAX_MOVE_PX + 1, 1)).toBe("drag");
  });
});
