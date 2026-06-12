"""Demo seed — the end-of-June Mode A demo station.

Run with:

    uv run python -m tcsh_ar_api.seed_demo

Creates (idempotent on the anchor label):

  - anchor ``demo-01`` (size_mm=100 — matches the printed
    ``docs/demo/qr-demo-01-url-100mm-A4.pdf`` sheet and the frontend's
    ``MOCK_QR_SIZE_MM``)
  - 6 textures backed by the mock PNGs in ``docs/demo/`` (bytes copied
    into the texture storage dir, rows pointed at them)
  - 6 AR objects ("demo 面板 01"…) and 6 placements whose transforms are
    a 1:1 copy of ``apps/web/src/lib/ar/mock-placements.ts`` — when the
    frontend's ``usePlacements`` switches from the mock module to the
    API, the rendered scene must not move.

Keep the two sources in sync BY HAND until the mock module is deleted:
this file and mock-placements.ts both encode the same arc layout.
"""

from __future__ import annotations

import asyncio
import math
import shutil
from pathlib import Path
from typing import Any

from sqlalchemy import select

from tcsh_ar_api.anchors.models import Anchor
from tcsh_ar_api.config import get_settings
from tcsh_ar_api.db.session import SessionLocal
from tcsh_ar_api.objects.models import ARObject
from tcsh_ar_api.placements.models import Placement
from tcsh_ar_api.textures.models import Texture

DEMO_STATION_LABEL = "demo-01"
DEMO_QR_SIZE_MM = 100

# repo_root/docs/demo — resolved relative to this file:
# src/tcsh_ar_api/seed_demo.py → src → api → apps → repo root
_DEMO_ASSETS = Path(__file__).resolve().parents[3].parent / "docs" / "demo"


def _yaw(rad: float) -> dict[str, float]:
    """Quaternion for a rotation of `rad` around +Y — mirrors mock-placements."""
    return {
        "x": 0.0,
        "y": math.sin(rad / 2),
        "z": 0.0,
        "w": math.cos(rad / 2),
    }


def _transform(
    pos: tuple[float, float, float],
    yaw_rad: float,
    size: float,
) -> dict[str, Any]:
    return {
        "position": {"x": pos[0], "y": pos[1], "z": pos[2]},
        "rotation": _yaw(yaw_rad),
        "scale": {"x": size, "y": size, "z": 1.0},
    }


# (texture file label, position, yaw, quad size) — 1:1 with mock-placements.ts.
_LAYOUT: list[tuple[str, tuple[float, float, float], float, float]] = [
    ("01", (0.0, 0.9, -1.4), 0.0, 0.4),
    ("02", (0.0, 1.45, -1.6), 0.0, 0.35),
    ("03", (-0.7, 0.6, -1.3), math.pi / 7, 0.3),
    ("04", (-1.1, 1.2, -1.7), math.pi / 5, 0.45),
    ("05", (0.7, 0.45, -1.2), -math.pi / 7, 0.3),
    ("06", (1.15, 1.65, -2.0), -math.pi / 4.5, 0.5),
]


async def seed_demo() -> None:
    settings = get_settings()
    storage_dir = settings.texture_storage_dir
    storage_dir.mkdir(parents=True, exist_ok=True)

    async with SessionLocal() as session:
        existing = (
            await session.execute(
                select(Anchor).where(Anchor.label == DEMO_STATION_LABEL).limit(1)
            )
        ).scalar_one_or_none()
        if existing is not None:
            print(f"Demo seed skipped: anchor '{DEMO_STATION_LABEL}' already exists.")
            return

        anchor = Anchor(label=DEMO_STATION_LABEL, size_mm=DEMO_QR_SIZE_MM)
        session.add(anchor)
        await session.flush()

        for num, pos, yaw_rad, size in _LAYOUT:
            src = _DEMO_ASSETS / f"texture-mock-{num}.png"
            if not src.is_file():
                raise FileNotFoundError(
                    f"missing demo asset {src} — run from a full repo checkout"
                )
            data = src.read_bytes()

            texture = Texture(
                label=f"demo 貼圖 {num}",
                filename=src.name,
                mime_type="image/png",
                size_bytes=len(data),
            )
            session.add(texture)
            await session.flush()  # allocate texture.id for the file name

            # Mirror TextureService._file_path layout so GET /textures/{id}/file
            # serves these without special-casing seeded rows.
            shutil.copyfile(src, storage_dir / f"{texture.id}{src.suffix}")

            obj = ARObject(
                label=f"demo 面板 {num}",
                description="六月底 Mode A demo 的 mock 面板",
            )
            session.add(obj)
            await session.flush()

            session.add(
                Placement(
                    ar_object_id=obj.id,
                    anchor_id=anchor.id,
                    texture_id=texture.id,
                    transform=_transform(pos, yaw_rad, size),
                )
            )

        await session.commit()
        print(
            f"Demo seed done: anchor '{DEMO_STATION_LABEL}' (size_mm="
            f"{DEMO_QR_SIZE_MM}) + 6 textures + 6 objects + 6 placements."
        )


if __name__ == "__main__":
    asyncio.run(seed_demo())
