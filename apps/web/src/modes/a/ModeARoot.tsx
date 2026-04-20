import { Link } from "react-router-dom";

/**
 * Mode A entry — on-site AR painting over physical objects. This scaffolds
 * the outer shell; the A1–A6 screens arrive in issues #11–#16, with the
 * QR + IMU + solvePnP tracking pipeline living in `src/lib/ar/`.
 */
export default function ModeARoot() {
  return (
    <div
      data-mode="a"
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-6"
    >
      <h1 className="text-2xl font-semibold">Mode A · On-site AR</h1>
      <p className="max-w-md text-center text-sm text-[color:var(--color-muted)]">
        QR + IMU-based on-site AR viewing. A1–A6 screens land in issues
        #11–#16; QR pose and IMU tracking live in #13 / #17.
      </p>
      <Link
        to="/"
        className="text-sm text-[color:var(--color-muted)] hover:text-[color:var(--color-fg)]"
      >
        ← Back to landing
      </Link>
    </div>
  );
}
