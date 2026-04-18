"""Minimal seed data for development.

Run with:

    uv run python -m tcsh_ar_api.seed

Idempotent: if any anchors exist the script no-ops. Wipe with
`alembic downgrade base && alembic upgrade head` if you need a clean slate.
"""

from __future__ import annotations

import asyncio
from typing import Any

from sqlalchemy import select

from tcsh_ar_api.anchors.models import Anchor
from tcsh_ar_api.db.session import SessionLocal
from tcsh_ar_api.objects.models import ARObject
from tcsh_ar_api.placements.models import Placement


def _default_transform() -> dict[str, Any]:
    return {
        "position": {"x": 0.0, "y": 0.0, "z": 0.0},
        "rotation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
        "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
    }


async def seed() -> None:
    async with SessionLocal() as session:
        existing = (await session.execute(select(Anchor).limit(1))).scalar_one_or_none()
        if existing is not None:
            print("Seed skipped: anchors table already populated.")
            return

        anchors = [
            Anchor(label=f"Station {letter}", size_mm=200)
            for letter in ["A", "B", "C", "D", "E"]
        ]
        session.add_all(anchors)
        await session.flush()

        objects = [
            ARObject(label="彩繪神像", description="祭祀用彩繪神像"),
            ARObject(label="米筐", description="裝米的傳統容器"),
            ARObject(label="金紙", description="祭祀燃燒的金紙"),
            ARObject(label="香爐", description="廟宇中央的香爐"),
            ARObject(label="燈籠", description="屋簷下的紅燈籠"),
            ARObject(label="神像", description="木雕神像"),
            ARObject(label="鼓", description="廟會儀式用鼓"),
        ]
        session.add_all(objects)
        await session.flush()

        # Give a couple of objects a placement at Station A to prove relations work
        station_a = anchors[0]
        session.add_all(
            [
                Placement(
                    ar_object_id=objects[0].id,
                    anchor_id=station_a.id,
                    transform=_default_transform(),
                ),
                Placement(
                    ar_object_id=objects[1].id,
                    anchor_id=station_a.id,
                    transform=_default_transform(),
                ),
            ]
        )

        await session.commit()
        print(
            f"Seeded {len(anchors)} anchors, {len(objects)} objects, "
            f"2 placements at {station_a.label}."
        )


if __name__ == "__main__":
    asyncio.run(seed())
