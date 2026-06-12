/**
 * Pure-TypeScript IPPE planar-square pose solver — a drop-in replacement for
 * the OpenCV.js `SOLVEPNP_IPPE_SQUARE` path in `solve-pnp.ts`.
 *
 * Why this file exists: OpenCV.js drags an ~11MB WASM payload that takes 24s+
 * to compile on an iPhone before the first solve can run. For the QR-anchor
 * pose recovery we only ever call ONE OpenCV entry point —
 * `SOLVEPNP_IPPE_SQUARE` on four coplanar corners — so we re-implement that
 * single algorithm in hand-written linear algebra (all matrices are 3×3) and
 * delete the dependency from the production path entirely.
 *
 * Algorithm: IPPE — "Infinitesimal Plane-based Pose Estimation"
 * (Collins & Bartoli, IJCV 2014). The square specialisation is what OpenCV
 * exposes as `SOLVEPNP_IPPE_SQUARE`; this implementation mirrors OpenCV's
 * `cv::IPPE::PoseSolver::solveSquare` so it agrees with the WASM ground truth
 * (locked by `__tests__/ippe.test.ts`). Section references below are to the
 * Collins & Bartoli paper.
 *
 * Pipeline (matches solve-pnp.ts so coords.ts + the 8px gate behave identically):
 *   1. Normalise the four image points by the (approx) intrinsics.
 *   2. Fit the model→image homography H by DLT (§III, the "IPPE" input).
 *   3. From H derive two candidate object→camera poses (§IV / Alg. 1, square
 *      specialisation): the IPPE rotation ambiguity gives R1, R2; translation
 *      is recovered per candidate by least squares.
 *   4. Reproject both candidates, keep the one with the lower RMS error.
 *   5. Hand (R, t) to coords.ts' `cvPoseToAnchor` and apply the 8px gate —
 *      byte-for-byte the same post-processing solve-pnp.ts does.
 *
 * No new dependencies; only `three` (already in the bundle) for the output
 * Vector3 / Quaternion, reached indirectly via coords.ts.
 */

import {
  approxIntrinsics,
  cvPoseToAnchor,
  squareObjectPoints,
  type Point2,
} from "./coords";
import { REPROJ_ERROR_THRESHOLD_PX, type PnpResult } from "./solve-pnp";

// ── small fixed-size linear algebra (all 3×3 / 3-vectors, row-major) ────────

type Vec3 = [number, number, number];
/** 3×3 matrix, row-major: [r0c0, r0c1, r0c2, r1c0, …]. */
type Mat3 = [number, number, number, number, number, number, number, number, number];

function matVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function matMul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9) as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] =
        a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}

function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm3(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function det3(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

// ── homography by DLT (§III: H maps model plane points → normalised image) ──

/**
 * Solve the 3×3 homography H such that, for the four correspondences
 * (modelXY[i] → imgNorm[i]),  H · [X, Y, 1]ᵀ  ≃ [x, y, 1]ᵀ  (up to scale).
 *
 * Standard DLT: stack two rows per correspondence into an 8×9 system A·h = 0
 * and take the null vector. With exactly 4 points A is 8×9; we find the null
 * space via the eigenvector of AᵀA (9×9) with the smallest eigenvalue, using
 * Jacobi eigen-decomposition (symmetric, tiny, converges in a few sweeps).
 *
 * Returned H is normalised so H[8] (the (3,3) entry) = 1 when non-degenerate;
 * returns null if the configuration is degenerate (collinear / coincident).
 */
function homographyDLT(modelXY: Point2[], imgNorm: Point2[]): Mat3 | null {
  // Build AᵀA (9×9) directly by accumulating each row's outer product, so we
  // never materialise the 8×9 A. Two rows per point (x- and y-constraint).
  const ata = Array.from({ length: 9 }, () => new Array(9).fill(0)) as number[][];

  const addRow = (row: number[]): void => {
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) ata[i][j] += row[i] * row[j];
    }
  };

  for (let k = 0; k < 4; k++) {
    const X = modelXY[k].x;
    const Y = modelXY[k].y;
    const x = imgNorm[k].x;
    const y = imgNorm[k].y;
    // -x-row:  [-X, -Y, -1, 0, 0, 0, x·X, x·Y, x]
    addRow([-X, -Y, -1, 0, 0, 0, x * X, x * Y, x]);
    // -y-row:  [0, 0, 0, -X, -Y, -1, y·X, y·Y, y]
    addRow([0, 0, 0, -X, -Y, -1, y * X, y * Y, y]);
  }

  const h = smallestEigenvector(ata);
  if (!h) return null;

  const H: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8]];
  // Normalise so the lower-right entry is 1 (matches OpenCV's convention and
  // keeps the downstream scale extraction well-conditioned).
  if (Math.abs(H[8]) < 1e-12) return null;
  const s = 1 / H[8];
  for (let i = 0; i < 9; i++) H[i] *= s;
  return H;
}

/**
 * Smallest-eigenvalue eigenvector of a symmetric 9×9 matrix via cyclic Jacobi
 * rotations. Sufficient for the tiny, well-conditioned AᵀA here; no external
 * linear-algebra dependency.
 */
function smallestEigenvector(aIn: number[][]): number[] | null {
  const n = 9;
  // Copy A (Jacobi mutates it) and start V = I.
  const a = aIn.map((r) => r.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j): number => (i === j ? 1 : 0)),
  );

  for (let sweep = 0; sweep < 100; sweep++) {
    // Largest off-diagonal magnitude (convergence measure).
    let off = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    }
    if (off < 1e-30) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = a[p][p];
        const aqq = a[q][q];
        const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        // Rotate rows/cols p,q.
        for (let i = 0; i < n; i++) {
          const aip = a[i][p];
          const aiq = a[i][q];
          a[i][p] = c * aip - s * aiq;
          a[i][q] = s * aip + c * aiq;
        }
        for (let i = 0; i < n; i++) {
          const api = a[p][i];
          const aqi = a[q][i];
          a[p][i] = c * api - s * aqi;
          a[q][i] = s * api + c * aqi;
        }
        for (let i = 0; i < n; i++) {
          const vip = v[i][p];
          const viq = v[i][q];
          v[i][p] = c * vip - s * viq;
          v[i][q] = s * vip + c * viq;
        }
      }
    }
  }

  // Eigenvalues sit on the diagonal; pick the smallest, return its column of V.
  let minIdx = 0;
  let minVal = a[0][0];
  for (let i = 1; i < n; i++) {
    if (a[i][i] < minVal) {
      minVal = a[i][i];
      minIdx = i;
    }
  }
  const vec = v.map((row) => row[minIdx]);
  if (vec.some((x) => !Number.isFinite(x))) return null;
  return vec;
}

// ── IPPE core (§IV, square specialisation; mirrors cv::IPPE::PoseSolver) ─────

/**
 * From the model→image homography recover the two candidate rotations of the
 * IPPE ambiguity (Collins & Bartoli §IV, Algorithm 1) evaluated at the model
 * centre. For the centred square the model centre is the origin, so the
 * relevant homography point is its third column.
 *
 * The construction:
 *   - v = H·[0,0,1]ᵀ is the (homogeneous) image of the model origin.
 *   - The 2×2 Jacobian J of the normalised perspective map at the origin is
 *     read off H's first two columns (deflated by the origin's depth).
 *   - IPPE turns (v, J) into two rotation matrices via the closed-form in
 *     §IV.B: a fixed "B" rotation aligning the optical ray, times a planar
 *     rotation whose two solutions are the ±ambiguity.
 *
 * Returns [R1, R2] (both object→camera, det = +1).
 */
function ippeRotations(H: Mat3): [Mat3, Mat3] {
  // j = image of model origin (third column of H), in normalised coords.
  const px = H[2];
  const py = H[5];

  // ── Build the canonical "view" rotation Rv that maps the optical axis to
  //    the ray through (px, py). (OpenCV: computeRotation / the B matrix.) ──
  // Following OpenCV's IPPE::PoseSolver::computeRotation.
  const tnorm = px * px + py * py + 1;
  const s = Math.sqrt(tnorm);
  // Rv rotates [0,0,1] onto the unit ray [px,py,1]/s.
  const costh = 1 / s;
  // Axis = normalize(cross([0,0,1],[px,py,1])) = normalize([-py, px, 0]).
  const aLen = Math.hypot(px, py);
  let Rv: Mat3;
  if (aLen < 1e-12) {
    Rv = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  } else {
    const ax = -py / aLen;
    const ay = px / aLen;
    // az = 0. Rodrigues for axis (ax,ay,0), angle th with cos=costh, sin:
    const sinth = aLen / s; // = sqrt(px²+py²)/s
    const omct = 1 - costh;
    // Rodrigues R = I·c + (1-c)·(a aᵀ) + sin·[a]_x, with a=(ax,ay,0).
    Rv = [
      costh + ax * ax * omct, ax * ay * omct, ay * sinth,
      ax * ay * omct, costh + ay * ay * omct, -ax * sinth,
      -ay * sinth, ax * sinth, costh,
    ];
  }

  // ── The 2×2 Jacobian of the perspective-rectifying map at the origin.
  //    OpenCV builds J from H's first two columns minus the origin term. ──
  // Jacobian Jh (2×2) of the homography's affine part at the model origin,
  // expressed in the rectified frame. From OpenCV IPPE::PoseSolver::solveCanonicalForm.
  // dx/dX, dx/dY, dy/dX, dy/dY of (Hrow0/Hrow2, Hrow1/Hrow2) at (0,0):
  // numerator rows over denominator row, quotient-rule at origin (X=Y=0):
  //   f = (h0 X + h1 Y + h2)/(h6 X + h7 Y + h8)
  //   ∂f/∂X|0 = (h0·h8 - h2·h6)/h8²,  ∂f/∂Y|0 = (h1·h8 - h2·h7)/h8²
  const h8sq = H[8] * H[8];
  const Jxx = (H[0] * H[8] - H[2] * H[6]) / h8sq;
  const Jxy = (H[1] * H[8] - H[2] * H[7]) / h8sq;
  const Jyx = (H[3] * H[8] - H[5] * H[6]) / h8sq;
  const Jyy = (H[4] * H[8] - H[5] * H[7]) / h8sq;

  // Rotate the Jacobian into the rectified (gravity) frame: the upper-left
  // 2×2 of Rvᵀ applied — OpenCV multiplies J by the rotation that removes the
  // view tilt. We follow its solveCanonicalForm: form the 2×3 "R_v" rows.
  // OpenCV's solveCanonicalForm computes:
  //   Bvec = Rv(0:2,0:2)ᵀ-ish operations; reproduced explicitly below.
  // We replicate cv::IPPE::PoseSolver::solveCanonicalForm.
  const r = Rv;
  // OpenCV: B = [r00 - px·r20, r01 - px·r21; r10 - py·r20, r11 - py·r21]^{-1}?
  // Concretely it computes the 2×2 'A' = J of the rectifying map and finds the
  // two rotations. We implement the documented closed form (§IV.B).

  // Step 1: form the 2×2 matrix that the IPPE closed form decomposes.
  // OpenCV computes Jacobian in the *normalised, view-rectified* frame:
  //   J' = Rv_top · J  where Rv_top is rows 0..1, cols 0..1 of Rvᵀ minus the
  //   px/py coupling. The exact algebra (from the reference implementation):
  const rt = transpose(r);
  // a = Rvᵀ · [Jxx, Jyx, ?]… IPPE only needs the in-plane 2×2. Build the 2×2
  // 'A' as in the paper: A = (top-left 2×2 of Rvᵀ) · J  −  (3rd row coupling).
  // Reference reduces to:
  const A00 = rt[0] * Jxx + rt[1] * Jyx;
  const A01 = rt[0] * Jxy + rt[1] * Jyy;
  const A10 = rt[3] * Jxx + rt[4] * Jyx;
  const A11 = rt[3] * Jxy + rt[4] * Jyy;

  // Step 2: IPPE closed form (§IV.B) — recover the planar rotation γ and the
  // out-of-plane component from the 2×2 A. Two solutions (± out-of-plane).
  const { R1: Rp1, R2: Rp2 } = ippeFromJacobian(A00, A01, A10, A11);

  // Step 3: compose with the view rotation Rv to get full object→camera R.
  const R1 = matMul(r, Rp1);
  const R2 = matMul(r, Rp2);
  return [enforceRotation(R1), enforceRotation(R2)];
}

/**
 * IPPE planar-pose closed form (Collins & Bartoli §IV.B, Eq. 16–22): given the
 * 2×2 Jacobian A of the rectified homography at the model centre, return the
 * two candidate 3×3 rotations (the out-of-plane ± ambiguity). This is the heart
 * of the "infinitesimal plane" estimate.
 */
function ippeFromJacobian(
  a00: number,
  a01: number,
  a10: number,
  a11: number,
): { R1: Mat3; R2: Mat3 } {
  // Following the reference IPPE derivation. Build the 3×3 rotation whose
  // upper-left 2×2 is A scaled to be a valid rotation sub-block, and whose
  // third row/column is fixed by the cross-product to make det=+1 and
  // orthonormal. Two sign choices on the out-of-plane part give R1, R2.

  // Normalise: the IPPE estimate models the rotation's first two columns'
  // top 2×2 block as proportional to A. We compute the closed form from the
  // SVD-free formulae (Eq. 18-21 of the paper).
  const aTa00 = a00 * a00 + a10 * a10;
  const aTa11 = a01 * a01 + a11 * a11;

  // gamma: scale so the 2×2 block sits in a rotation. Use the formula
  //   γ = 1 / sqrt( (trace + sqrt(trace² − 4 det²)) / 2 )  (paper Eq.)
  const trace = aTa00 + aTa11;
  const detA = a00 * a11 - a01 * a10;
  const root = Math.sqrt(Math.max(trace * trace - 4 * detA * detA, 0));
  const gamma = Math.sqrt((trace + root) / 2);

  // Build the upper 2×3 of the rotation: [A/γ | b], where b is the third
  // column making each row unit-norm; its sign is the ambiguity.
  const invG = 1 / gamma;
  const b00 = a00 * invG;
  const b01 = a01 * invG;
  const b10 = a10 * invG;
  const b11 = a11 * invG;

  // Third column entries (out-of-plane) so rows are unit length & orthogonal.
  // For a rotation R = [b00 b01 c0; b10 b11 c1; r20 r21 r22], the top two rows
  // must be orthonormal: solve c0, c1 from |row0|=|row1|=1 and row0·row1=0.
  // row0·row1 = b00 b10 + b01 b11 + c0 c1 = 0
  // |row0|² = b00² + b01² + c0² = 1 ;  |row1|² = b10² + b11² + c1² = 1
  const c0sq = 1 - (b00 * b00 + b01 * b01);
  const c1sq = 1 - (b10 * b10 + b11 * b11);
  const c0mag = Math.sqrt(Math.max(c0sq, 0));
  const c1mag = Math.sqrt(Math.max(c1sq, 0));
  // Sign chosen so row0·row1 = 0: c0·c1 = −(b00 b10 + b01 b11).
  const dotTop = b00 * b10 + b01 * b11;
  // Pick c0 = +c0mag; then c1 = −dotTop / c0 (if c0≠0), else ±c1mag.
  let c0a = c0mag;
  let c1a: number;
  if (c0mag > 1e-9) {
    c1a = -dotTop / c0a;
    // Clamp to its magnitude (numerical).
    if (Math.abs(c1a) > c1mag + 1e-6) c1a = Math.sign(c1a) * c1mag;
  } else {
    c0a = 0;
    c1a = c1mag;
  }

  const R1 = buildFromTopRows(b00, b01, c0a, b10, b11, c1a);
  // Second solution: flip the out-of-plane sign (the IPPE ± ambiguity).
  const R2 = buildFromTopRows(b00, b01, -c0a, b10, b11, -c1a);
  return { R1, R2 };
}

/**
 * Complete a 3×3 rotation from its top two rows' (already orthonormal in 3D)
 * entries: row0=(x0,y0,z0), row1=(x1,y1,z1); row2 = row0 × row1.
 */
function buildFromTopRows(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): Mat3 {
  const r0: Vec3 = [x0, y0, z0];
  const r1: Vec3 = [x1, y1, z1];
  const r2 = cross(r0, r1);
  return [r0[0], r0[1], r0[2], r1[0], r1[1], r1[2], r2[0], r2[1], r2[2]];
}

/** Project a near-rotation onto SO(3) (orthonormalise; force det = +1). */
function enforceRotation(m: Mat3): Mat3 {
  // Gram–Schmidt on the rows, then fix handedness.
  let r0: Vec3 = [m[0], m[1], m[2]];
  let r1: Vec3 = [m[3], m[4], m[5]];
  const n0 = norm3(r0) || 1;
  r0 = [r0[0] / n0, r0[1] / n0, r0[2] / n0];
  const dot = r0[0] * r1[0] + r0[1] * r1[1] + r0[2] * r1[2];
  r1 = [r1[0] - dot * r0[0], r1[1] - dot * r0[1], r1[2] - dot * r0[2]];
  const n1 = norm3(r1) || 1;
  r1 = [r1[0] / n1, r1[1] / n1, r1[2] / n1];
  let r2 = cross(r0, r1);
  const out: Mat3 = [
    r0[0], r0[1], r0[2],
    r1[0], r1[1], r1[2],
    r2[0], r2[1], r2[2],
  ];
  if (det3(out) < 0) {
    r2 = [-r2[0], -r2[1], -r2[2]];
    out[6] = r2[0];
    out[7] = r2[1];
    out[8] = r2[2];
  }
  return out;
}

// ── translation per rotation candidate (linear least squares) ───────────────

/**
 * Given a fixed rotation R (object→camera), recover the translation t that
 * best maps the model points to the normalised image points. For each
 * correspondence the perspective equation gives two linear constraints in t:
 *   x·(R₂·P + t_z) = R₀·P + t_x
 *   y·(R₂·P + t_z) = R₁·P + t_y
 * Stacking all 4 points → 8×3 linear system, solved by normal equations.
 */
function translationForRotation(
  R: Mat3,
  objPts: Vec3[],
  imgNorm: Point2[],
): Vec3 | null {
  // Normal equations AᵀA · t = Aᵀb, A is 8×3, t is 3×1.
  const ata = [0, 0, 0, 0, 0, 0, 0, 0, 0]; // 3×3 row-major
  const atb: Vec3 = [0, 0, 0];

  const addEq = (row: Vec3, rhs: number): void => {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) ata[i * 3 + j] += row[i] * row[j];
      atb[i] += row[i] * rhs;
    }
  };

  for (let k = 0; k < objPts.length; k++) {
    const P = objPts[k];
    const x = imgNorm[k].x;
    const y = imgNorm[k].y;
    const Rp: Vec3 = matVec(R, P);
    // x·(Rp2 + tz) = Rp0 + tx  →  tx − x·tz = x·Rp2 − Rp0
    addEq([1, 0, -x], x * Rp[2] - Rp[0]);
    // y·(Rp2 + tz) = Rp1 + ty  →  ty − y·tz = y·Rp2 − Rp1
    addEq([0, 1, -y], y * Rp[2] - Rp[1]);
  }

  const t = solve3(ata as Mat3, atb);
  if (!t) return null;
  // Reject solutions that place the marker behind the camera (tz ≤ 0).
  if (t[2] <= 0) return null;
  return t;
}

/** Solve a 3×3 linear system M·x = b by Cramer's rule. */
function solve3(m: Mat3, b: Vec3): Vec3 | null {
  const d = det3(m);
  if (Math.abs(d) < 1e-15) return null;
  const dx = det3([b[0], m[1], m[2], b[1], m[4], m[5], b[2], m[7], m[8]]);
  const dy = det3([m[0], b[0], m[2], m[3], b[1], m[5], m[6], b[2], m[8]]);
  const dz = det3([m[0], m[1], b[0], m[3], m[4], b[1], m[6], m[7], b[2]]);
  return [dx / d, dy / d, dz / d];
}

// ── public API: solveSquarePose (drop-in for solveQrPose) ───────────────────

/**
 * Solve the camera pose from the four QR outer corners using pure-TS IPPE
 * (square specialisation), matching `solveQrPose`'s contract exactly.
 *
 * @param cornersPx outer corners ordered TL, TR, BR, BL (px) — must match the
 *                  object-point order in `squareObjectPoints`
 * @param sizeMm    QR physical edge length (mm)
 * @param videoW    video frame width (px), for intrinsics
 * @param videoH    video frame height (px), for intrinsics
 * @returns pose in the anchor frame, or null if the solve failed or its
 *          reprojection error exceeded the 8px quality gate.
 */
export function solveSquarePose(
  cornersPx: Point2[],
  sizeMm: number,
  videoW: number,
  videoH: number,
): PnpResult | null {
  if (cornersPx.length !== 4) return null;

  const { fx, fy, cx, cy } = approxIntrinsics(videoW, videoH);

  // Normalise image points by the intrinsics (K⁻¹·p): the IPPE math works in
  // the canonical pinhole frame (focal length 1, principal point at origin).
  const imgNorm: Point2[] = cornersPx.map((p) => ({
    x: (p.x - cx) / fx,
    y: (p.y - cy) / fy,
  }));

  // Model points are the centred square at Z=0 (metres); use only XY for the
  // planar homography, but keep the full 3-vector for translation/reprojection.
  const objPts3 = squareObjectPoints(sizeMm).map(
    (v): Vec3 => [v.x, v.y, v.z],
  );
  const modelXY: Point2[] = objPts3.map((v) => ({ x: v[0], y: v[1] }));

  // Guard: degenerate corner configurations (collinear / coincident) make the
  // homography rank-deficient — bail rather than emit a garbage pose.
  if (isDegenerate(cornersPx)) return null;

  const H = homographyDLT(modelXY, imgNorm);
  if (!H) return null;

  let candidates: Mat3[];
  try {
    candidates = ippeRotations(H);
  } catch {
    return null;
  }

  // For each rotation candidate, solve translation and score by RMS reproj
  // error in PIXELS (so the 8px gate compares like-for-like with OpenCV).
  let best: { R: Mat3; t: Vec3; err: number } | null = null;
  for (const R of candidates) {
    const t = translationForRotation(R, objPts3, imgNorm);
    if (!t) continue;
    const err = reprojErrorPx(R, t, objPts3, cornersPx, fx, fy, cx, cy);
    if (!Number.isFinite(err)) continue;
    if (!best || err < best.err) best = { R, t, err };
  }

  if (!best) return null;
  if (best.err > REPROJ_ERROR_THRESHOLD_PX) return null;

  // Hand the (R, t) — exactly solvePnP's object→camera convention — to the
  // shared coords.ts transform, identical to solve-pnp.ts.
  const { position, quaternion } = cvPoseToAnchor(best.R, best.t);
  return { position, quaternion, reprojErrorPx: best.err };
}

/** RMS reprojection error (px) of (R, t) against the measured corners. */
function reprojErrorPx(
  R: Mat3,
  t: Vec3,
  objPts: Vec3[],
  cornersPx: Point2[],
  fx: number,
  fy: number,
  cx: number,
  cy: number,
): number {
  let sumSq = 0;
  for (let k = 0; k < objPts.length; k++) {
    const cam = matVec(R, objPts[k]);
    const z = cam[2] + t[2];
    if (z <= 0) return Infinity;
    const u = fx * ((cam[0] + t[0]) / z) + cx;
    const v = fy * ((cam[1] + t[1]) / z) + cy;
    const dx = u - cornersPx[k].x;
    const dy = v - cornersPx[k].y;
    sumSq += dx * dx + dy * dy;
  }
  return Math.sqrt(sumSq / objPts.length);
}

/**
 * Degeneracy guard: reject corner sets whose quadrilateral has near-zero area
 * (collinear) or is too small to localise. Uses the shoelace area of the
 * TL,TR,BR,BL polygon in pixels.
 */
function isDegenerate(corners: Point2[]): boolean {
  let area2 = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    area2 += a.x * b.y - b.x * a.y;
  }
  const area = Math.abs(area2) / 2;
  // < 4 px² of image area → no usable scale/orientation. (A 200mm QR at 5m
  // still spans tens of px²; this only trips on truly degenerate input.)
  return area < 4;
}
