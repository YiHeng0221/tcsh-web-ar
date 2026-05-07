from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tcsh_ar_api.db.base import GUID, Base

if TYPE_CHECKING:
    from tcsh_ar_api.placements.models import Placement


class Texture(Base):
    """A binary texture stored on the local filesystem.

    The file lives at ``settings.texture_storage_dir / f"{id}{ext}"`` where
    ``ext`` is derived from the original filename (or "" if it had none). We
    don't store the path in the row — given the id we can reconstruct it, and
    keeping the row immutable on rename of the storage dir is convenient.

    Frontend references the file via the API's ``GET /textures/{id}/file``
    route, which the schema layer surfaces as ``file_url``.
    """

    __tablename__ = "textures"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(), primary_key=True, default=uuid.uuid4
    )
    label: Mapped[str] = mapped_column(String(256), nullable=False)
    filename: Mapped[str] = mapped_column(String(256), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
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
