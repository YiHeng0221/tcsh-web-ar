from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tcsh_ar_api.db.base import Base

if TYPE_CHECKING:
    from tcsh_ar_api.placements.models import Placement


class Anchor(Base):
    """A viewing station — a QR code placed on the ground around the artwork.

    `size_mm` is the real-world side length of the printed QR and is used by
    the client-side `solvePnP` to recover 6DoF camera pose. `world_pos`
    optionally locates the station relative to a venue origin so cross-anchor
    placements can be resolved at render time.
    """

    __tablename__ = "anchors"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    label: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    size_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    world_pos: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    placements: Mapped[list[Placement]] = relationship(
        back_populates="anchor", cascade="all, delete-orphan"
    )
