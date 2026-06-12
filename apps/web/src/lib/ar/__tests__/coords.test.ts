import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";

import {
  anchorObjectPoints,
  approxIntrinsics,
  cvPoseToAnchor,
  dimensionForVersion,
  extrapolateOuterCorners,
  fovYFromIntrinsics,
  squareObjectPoints,
  type Point2,
} from "../coords";

// ---------------------------------------------------------------------------
// Forward model (inverse of cvPoseToAnchor), used only to synthesise a known
// OpenCV (rcm, tcm) from a known anchor-frame camera pose, so the round-trip
// test exercises the real conversion against a ground truth.
//
// solve frame ↔ anchor frame: X→X, Y→−Z, Z→Y (see coords.ts SOLVE_TO_ANCHOR).
// camera frame OpenCV ↔ three: diag(1,-1,-1).
// ---------------------------------------------------------------------------
const SOLVE_TO_ANCHOR = new Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1,
);
const ANCHOR_TO_SOLVE = SOLVE_TO_ANCHOR.clone().transpose();
const CV_TO_GL_CAMERA = new Matrix4().set(
  1, 0, 0, 0,
  0, -1, 0, 0,
  0, 0, -1, 0,
  0, 0, 0, 1,
);

/** Given a camera pose in the anchor frame, produce OpenCV's object→camera
 *  rotation (row-major 3×3) + translation in the solve frame. */
function anchorPoseToCv(
  position: Vector3,
  quaternion: Quaternion,
): { rcm: number[]; tcm: number[] } {
  // R_anchor = SOLVE_TO_ANCHOR · R_gl  ⇒  R_gl = ANCHOR_TO_SOLVE · R_anchor.
  const Ranchor = new Matrix4().makeRotationFromQuaternion(quaternion);
  const Rgl = ANCHOR_TO_SOLVE.clone().multiply(Ranchor);
  // R_gl = R_sc · CV_TO_GL  ⇒  R_sc = R_gl · CV_TO_GL (self-inverse).
  const Rsc = Rgl.clone().multiply(CV_TO_GL_CAMERA);
  // R (object→camera) = R_scᵀ.
  const R = Rsc.clone().transpose();

  // position_anchor = SOLVE_TO_ANCHOR · t_sc ⇒ t_sc = ANCHOR_TO_SOLVE · pos.
  const tsc = position.clone().applyMatrix4(ANCHOR_TO_SOLVE);
  // t_sc = −Rᵀ·t ⇒ t = −R·t_sc.
  const t = tsc.clone().applyMatrix4(R).multiplyScalar(-1);

  // Matrix4 is column-major in `.elements`; extract a row-major 3×3.
  const e = R.elements;
  const rcm = [
    e[0], e[4], e[8],
    e[1], e[5], e[9],
    e[2], e[6], e[10],
  ];
  return { rcm, tcm: [t.x, t.y, t.z] };
}

describe("cvPoseToAnchor round-trip", () => {
  const cases: Array<{ name: string; pos: Vector3; quat: Quaternion }> = [
    {
      name: "camera 1m above QR looking straight down",
      pos: new Vector3(0, 1, 0),
      quat: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2),
    },
    {
      name: "camera offset + tilted",
      pos: new Vector3(0.3, 1.5, 0.8),
      quat: new Quaternion().setFromEuler(new Euler(-1.1, 0.4, 0.2, "YXZ")),
    },
    {
      name: "camera looking at QR from the side",
      pos: new Vector3(-0.5, 0.6, 1.2),
      quat: new Quaternion().setFromEuler(new Euler(-0.6, -0.3, 0.0, "YXZ")),
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const { rcm, tcm } = anchorPoseToCv(c.pos, c.quat.clone().normalize());
      const recovered = cvPoseToAnchor(rcm, tcm);

      expect(recovered.position.x).toBeCloseTo(c.pos.x, 6);
      expect(recovered.position.y).toBeCloseTo(c.pos.y, 6);
      expect(recovered.position.z).toBeCloseTo(c.pos.z, 6);

      // Quaternion equality up to sign (q and −q are the same rotation).
      const qn = c.quat.clone().normalize();
      const dot = Math.abs(
        recovered.quaternion.x * qn.x +
          recovered.quaternion.y * qn.y +
          recovered.quaternion.z * qn.z +
          recovered.quaternion.w * qn.w,
      );
      expect(dot).toBeCloseTo(1, 5);
    });
  }
});

describe("extrapolateOuterCorners", () => {
  it("recovers the outer corners of an axis-aligned version-1 QR", () => {
    // Version 1 = 21 modules. Place the symbol with TL outer corner at the
    // pixel origin and a 10px module pitch, axis-aligned (u = +x, v = +y).
    const dim = 21;
    const modulePx = 10;
    const inset = 3.5 * modulePx; // finder centre offset from outer edge
    const sidePx = dim * modulePx; // 210px

    // Outer corners (ground truth).
    const tl = { x: 0, y: 0 };
    const tr = { x: sidePx, y: 0 };
    const br = { x: sidePx, y: sidePx };
    const bl = { x: 0, y: sidePx };

    // Finder centres sit 3.5 modules in from their corners.
    const finders = {
      topLeft: { x: tl.x + inset, y: tl.y + inset },
      topRight: { x: tr.x - inset, y: tr.y + inset },
      bottomLeft: { x: bl.x + inset, y: bl.y - inset },
    };

    const [rTL, rTR, rBR, rBL] = extrapolateOuterCorners(finders, dim);
    expectPointClose(rTL, tl);
    expectPointClose(rTR, tr);
    expectPointClose(rBR, br);
    expectPointClose(rBL, bl);
  });

  it("recovers corners of a rotated + scaled QR", () => {
    const dim = 25; // version 3-ish dimension for variety
    const modulePx = 6;
    const inset = 3.5 * modulePx;
    const sidePx = dim * modulePx;

    // Rotate the symbol by 30° about an origin and translate it.
    const theta = (30 * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const origin = { x: 120, y: 90 };
    const rot = (p: Point2): Point2 => ({
      x: origin.x + p.x * cos - p.y * sin,
      y: origin.y + p.x * sin + p.y * cos,
    });

    const tl = rot({ x: 0, y: 0 });
    const tr = rot({ x: sidePx, y: 0 });
    const br = rot({ x: sidePx, y: sidePx });
    const bl = rot({ x: 0, y: sidePx });

    const finders = {
      topLeft: rot({ x: inset, y: inset }),
      topRight: rot({ x: sidePx - inset, y: inset }),
      bottomLeft: rot({ x: inset, y: sidePx - inset }),
    };

    const [rTL, rTR, rBR, rBL] = extrapolateOuterCorners(finders, dim);
    expectPointClose(rTL, tl);
    expectPointClose(rTR, tr);
    expectPointClose(rBR, br);
    expectPointClose(rBL, bl);
  });
});

describe("intrinsics + geometry helpers", () => {
  it("approxIntrinsics matches spec §5 (fx=fy=w*0.9, cx/cy centre)", () => {
    const { fx, fy, cx, cy } = approxIntrinsics(1280, 720);
    expect(fx).toBe(1152);
    expect(fy).toBe(1152);
    expect(cx).toBe(640);
    expect(cy).toBe(360);
  });

  it("fovYFromIntrinsics inverts the focal length", () => {
    const { fy } = approxIntrinsics(1280, 720);
    const fov = fovYFromIntrinsics(720, fy);
    // tan(fov/2) = h/(2 fy)
    expect(Math.tan(fov / 2)).toBeCloseTo(720 / (2 * fy), 10);
  });

  it("dimensionForVersion = 17 + 4·version", () => {
    expect(dimensionForVersion(1)).toBe(21);
    expect(dimensionForVersion(2)).toBe(25);
    expect(dimensionForVersion(3)).toBe(29);
  });

  it("square vs anchor object points share the half-edge", () => {
    const sq = squareObjectPoints(200);
    const an = anchorObjectPoints(200);
    expect(sq).toHaveLength(4);
    expect(an).toHaveLength(4);
    // s = 100mm = 0.1m
    expect(sq[1].x).toBeCloseTo(0.1, 10); // TR x
    expect(an[1].x).toBeCloseTo(0.1, 10);
    // square is in XY (z=0); anchor is in XZ (y=0).
    expect(sq.every((p) => p.z === 0)).toBe(true);
    expect(an.every((p) => p.y === 0)).toBe(true);
  });
});

function expectPointClose(a: Point2, b: Point2, digits = 4): void {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
}
