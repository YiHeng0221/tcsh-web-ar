from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tcsh_ar_api.db.base import Base

if TYPE_CHECKING:
    from tcsh_ar_api.placements.models import Placement


class ARObject(Base):
    """One physical object within the artwork — e.g. "彩繪神像", "米筐".

    Class name prefixed with `AR` to avoid shadowing Python's builtin `object`.
    Database table is `ar_objects` for the same reason.
    """

    __tablename__ = "ar_objects"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
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
        back_populates="ar_object", cascade="all, delete-orphan"
    )
