from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tcsh_ar_api.anchors.models import Anchor
from tcsh_ar_api.db.base import GUID, Base
from tcsh_ar_api.objects.models import ARObject
from tcsh_ar_api.textures.models import Texture


class Placement(Base):
    """Places one ARObject at one Anchor, optionally with a texture assigned.

    `transform` carries the 3D pose (position / rotation quaternion / scale)
    of the object relative to the anchor's local frame. `uv_transform` carries
    the 2D adjustment (scale / rotate / offset) applied to the texture when
    mapped onto the object's UVs. Both are stored as JSON (SQLite JSON1 /
    Postgres JSONB depending on the active dialect) and validated at the
    Pydantic schema layer — see #9 for the Transform / UVTransform shapes.
    """

    __tablename__ = "placements"
    __table_args__ = (
        UniqueConstraint("ar_object_id", "anchor_id", name="uq_placement_object_anchor"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    ar_object_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("ar_objects.id", ondelete="CASCADE"),
        nullable=False,
    )
    anchor_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("anchors.id", ondelete="CASCADE"),
        nullable=False,
    )
    texture_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("textures.id", ondelete="SET NULL"),
        nullable=True,
    )
    transform: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    uv_transform: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # Mode C visibility toggle (artist hides a placement without deleting it).
    # Mode A's render layer filters on this; default visible.
    is_show: Mapped[bool] = mapped_column(
        Boolean, server_default=text("1"), nullable=False, default=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    ar_object: Mapped[ARObject] = relationship(back_populates="placements")
    anchor: Mapped[Anchor] = relationship(back_populates="placements")
    texture: Mapped[Texture | None] = relationship(back_populates="placements")
