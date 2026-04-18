from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tcsh_ar_api.db.base import Base

if TYPE_CHECKING:
    from tcsh_ar_api.placements.models import Placement


class Texture(Base):
    """A binary texture stored in Supabase Storage.

    `storage_path` is the path within the storage bucket (we don't store the
    full URL because bucket/project can change; the frontend asks the API for
    a signed read URL when rendering).
    """

    __tablename__ = "textures"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    storage_path: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    mime: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    original_filename: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    placements: Mapped[list[Placement]] = relationship(back_populates="texture")
