# `lib/ar/`

Mode A tracking pipeline: QR detection (`@zxing/browser`) + solvePnP pose
recovery (OpenCV.js) + IMU rotation (`DeviceMotionEvent` /
`DeviceOrientationEvent`).

Lands in:
- #13 Mode A · A3 QR + solvePnP
- #17 Mode A · IMU angle tracking

Station-based AR architecture details: see
`docs/dev-journal/2026-04-18-ar-tracking-architecture.md`.
