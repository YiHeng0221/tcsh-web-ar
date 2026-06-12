import { Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  applyAlignment,
  computeAlignment,
  poseToMatrix,
  type Pose,
} from "../alignment";

/** A camera pose built from an Euler-free quaternion + translation. */
function pose(
  position: [number, number, number],
  axis: [number, number, number],
  angleRad: number,
): Pose {
  const q = new Quaternion().setFromAxisAngle(
    new Vector3(...axis).normalize(),
    angleRad,
  );
  return { position: new Vector3(...position), quaternion: q };
}

function expectVecClose(a: Vector3, b: Vector3, eps = 1e-9): void {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
  expect(a.z).toBeCloseTo(b.z, 9);
  void eps;
}

describe("computeAlignment", () => {
  it("recovers the identity when SLAM and anchor frames coincide", () => {
    const cam = pose([1, 2, 3], [0, 1, 0], 0.7);
    const T = computeAlignment(cam, cam); // M_qr === M_slam → T = I
    const I = new Matrix4().identity();
    for (let i = 0; i < 16; i++) {
      expect(T.elements[i]).toBeCloseTo(I.elements[i], 9);
    }
  });

  it("maps the anchor origin to the camera-in-slam · (camera-in-anchor)⁻¹ image", () => {
    // Construct a known ground-truth alignment, then verify computeAlignment
    // backs it out from the two camera poses it implies.
    const Ttrue = new Matrix4().compose(
      new Vector3(5, -1, 2),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 3),
      new Vector3(1, 1, 1),
    );
    const camInAnchor = pose([0.2, 1.4, -0.8], [1, 0, 0], -0.5);
    // camera-in-slam = Ttrue · camera-in-anchor
    const mSlam = Ttrue.clone().multiply(poseToMatrix(camInAnchor));
    const pSlam = new Vector3();
    const qSlam = new Quaternion();
    const sSlam = new Vector3();
    mSlam.decompose(pSlam, qSlam, sSlam);
    const camInSlam: Pose = { position: pSlam, quaternion: qSlam };

    const T = computeAlignment(camInAnchor, camInSlam);
    for (let i = 0; i < 16; i++) {
      expect(T.elements[i]).toBeCloseTo(Ttrue.elements[i], 9);
    }
  });

  it("places a point that is at the camera in anchor frame at the camera in slam frame", () => {
    // The camera's own anchor-frame position must map to its slam-frame position.
    const camInAnchor = pose([0.3, 1.5, -1.2], [0, 1, 0], 0.9);
    const camInSlam = pose([4, 0.2, 7], [0, 0, 1], 0.4);
    const T = computeAlignment(camInAnchor, camInSlam);
    const mapped = camInAnchor.position.clone().applyMatrix4(T);
    expectVecClose(mapped, camInSlam.position);
  });
});

describe("applyAlignment", () => {
  it("is a no-op under the identity alignment", () => {
    const I = new Matrix4().identity();
    const anchor = {
      position: new Vector3(0, 0.9, -1.4),
      quaternion: new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        0.2,
      ),
      scale: new Vector3(0.4, 0.4, 1),
    };
    const out = applyAlignment(I, anchor);
    expectVecClose(out.position, anchor.position);
    // Decompose round-trips a quaternion through a Matrix4, so allow the
    // ~1e-7 float error that introduces rather than the 1e-9 used elsewhere.
    expect(out.quaternion.angleTo(anchor.quaternion)).toBeCloseTo(0, 6);
    expectVecClose(out.scale, anchor.scale);
  });

  it("composes the alignment with the placement transform", () => {
    const T = computeAlignment(
      pose([0, 1.5, -1], [0, 1, 0], 0.3),
      pose([2, 0, 3], [0, 1, 0], 1.1),
    );
    const anchor = {
      position: new Vector3(0.7, 0.6, -1.3),
      quaternion: new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        Math.PI / 7,
      ),
      scale: new Vector3(0.3, 0.3, 1),
    };
    const out = applyAlignment(T, anchor);

    // Reference: build expected world matrix directly and decompose.
    const expected = T.clone().multiply(
      new Matrix4().compose(anchor.position, anchor.quaternion, anchor.scale),
    );
    const ep = new Vector3();
    const eq = new Quaternion();
    const es = new Vector3();
    expected.decompose(ep, eq, es);

    expectVecClose(out.position, ep);
    expect(out.quaternion.angleTo(eq)).toBeCloseTo(0, 9);
    expectVecClose(out.scale, es);
  });
});
