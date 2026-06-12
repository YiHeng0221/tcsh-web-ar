/**
 * Mock placements for Mode A frontend testing — six numbered demo
 * textures arranged around the `demo-01` station QR, so A4's render
 * layer (and any dev harness page) can be exercised before the
 * backend placements pipeline is wired up.
 *
 * Coordinate frame = the anchor frame defined in
 * `docs/specs/2026-06-13-mode-a-core-ar.md` §5:
 *   - origin at the QR centre, QR lying flat on the ground
 *   - +Y up, +X to the QR's own right, right-handed → -Z is "ahead"
 *     of a viewer standing at the station looking at the artwork
 *   - units: METERS (matches solve-pnp.ts output and three.js)
 *
 * Layout: a shallow arc 1.2–2.0 m ahead of the QR at heights 0.4–1.7 m
 * — roughly where the 2 m spiral artwork's panels would sit from a
 * station viewpoint. Quads face back toward the station (+Z) with
 * slight yaw so misalignment, wrong handedness, or scale errors are
 * obvious at a glance (the textures' stripes + numbers exist for
 * exactly that).
 *
 * NOT generated from OpenAPI on purpose: this is a dev fixture, not a
 * network boundary. The real A4 data path parses `PlacementOut` from
 * the API; this module mirrors its `Transform` shape (position /
 * rotation quaternion / scale) so swapping in the API response is a
 * type-compatible change.
 */

export type MockPlacement = {
  id: string;
  /** Served from apps/web/public/demo-textures/ in dev. */
  textureUrl: string;
  /** Meters, anchor frame (see header comment). */
  position: [x: number, y: number, z: number];
  /** Quaternion [x, y, z, w], anchor frame. */
  rotation: [x: number, y: number, z: number, w: number];
  /** Quad size in meters — [width, height, 1]. */
  scale: [sx: number, sy: number, sz: number];
};

/** Quaternion for a rotation of `rad` around +Y (yaw). */
function yaw(rad: number): [number, number, number, number] {
  return [0, Math.sin(rad / 2), 0, Math.cos(rad / 2)];
}

export const MOCK_STATION_ID = "demo-01";

/** Matches the printed demo sheets (docs/demo/): 100 mm desk / 160 mm floor. */
export const MOCK_QR_SIZE_MM = 100;

export const MOCK_PLACEMENTS: MockPlacement[] = [
  // Centre pair, straight ahead — the first thing a tester should see.
  {
    id: "mock-01",
    textureUrl: "/demo-textures/texture-mock-01.png",
    position: [0, 0.9, -1.4],
    rotation: yaw(0),
    scale: [0.4, 0.4, 1],
  },
  {
    id: "mock-02",
    textureUrl: "/demo-textures/texture-mock-02.png",
    position: [0, 1.45, -1.6],
    rotation: yaw(0),
    scale: [0.35, 0.35, 1],
  },
  // Left arm of the arc, yawed inward toward the viewer.
  {
    id: "mock-03",
    textureUrl: "/demo-textures/texture-mock-03.png",
    position: [-0.7, 0.6, -1.3],
    rotation: yaw(Math.PI / 7),
    scale: [0.3, 0.3, 1],
  },
  {
    id: "mock-04",
    textureUrl: "/demo-textures/texture-mock-04.png",
    position: [-1.1, 1.2, -1.7],
    rotation: yaw(Math.PI / 5),
    scale: [0.45, 0.45, 1],
  },
  // Right arm.
  {
    id: "mock-05",
    textureUrl: "/demo-textures/texture-mock-05.png",
    position: [0.7, 0.45, -1.2],
    rotation: yaw(-Math.PI / 7),
    scale: [0.3, 0.3, 1],
  },
  {
    id: "mock-06",
    textureUrl: "/demo-textures/texture-mock-06.png",
    position: [1.15, 1.65, -2.0],
    rotation: yaw(-Math.PI / 4.5),
    scale: [0.5, 0.5, 1],
  },
];
