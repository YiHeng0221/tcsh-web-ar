/**
 * Click-vs-drag arbitration for the Blender-style placement canvas.
 *
 * The editor canvas shares pointer gestures between two intents:
 *   - orbit the camera (drag), serviced by OrbitControls, and
 *   - select / deselect a placement (click), serviced by a raycast.
 *
 * Rather than fight OrbitControls for the event, we let it handle every
 * drag and only treat a gesture as a *click* when the pointer barely moved
 * and was released quickly. This keeps the two intents naturally separated
 * with zero event stealing (see issue #29, comment 2).
 *
 * Kept in its own pure module (no React / three imports) so it unit-tests
 * in the repo's Node test environment without pulling in R3F.
 */

/** Max pointer displacement (px) for a gesture to still count as a click.
 *  At or above this, the gesture is an orbit drag. */
export const CLICK_MAX_MOVE_PX = 6;

/** Max press duration (ms) for a gesture to still count as a click. */
export const CLICK_MAX_MS = 300;

/**
 * Classify a pointerdown→pointerup gesture. A gesture is a click only when
 * it stayed under *both* the displacement and the time threshold; anything
 * else is a drag (orbit) that OrbitControls has already handled.
 */
export function classifyPointerGesture(
  movedPx: number,
  elapsedMs: number,
): "click" | "drag" {
  return movedPx < CLICK_MAX_MOVE_PX && elapsedMs < CLICK_MAX_MS
    ? "click"
    : "drag";
}
