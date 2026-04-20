# `lib/3d/`

Three.js / R3F helpers shared by Mode A (AR render) and Mode B (3D viewer).

Lands in:
- #19 Mode B · B2 3D viewer (initial scene setup)
- #14 Mode A · A4 AR viewing (world-locked render over camera feed)

Convention: keep pure three.js utilities here; keep mode-specific components
inside `src/modes/<mode>/`.
