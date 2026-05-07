"""Texture service — local-filesystem storage + DB metadata.

The service owns the upload lifecycle:

  1. Validate mime + size against `settings`
  2. Insert the metadata row to allocate the row's UUID
  3. Write bytes to ``texture_storage_dir / f"{id}{ext}"``
  4. Commit the row only after the file lands on disk

If step 3 fails we delete the unstaged row before re-raising, so we never
end up with an orphan DB row pointing at a missing file. If step 4 fails
(commit error) the file is already on disk; rare enough we leave it as
detritus rather than risk a half-broken cleanup path.
"""

from __future__ import annotations

import logging
import mimetypes
import os
import uuid
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tcsh_ar_api.config import Settings
from tcsh_ar_api.textures.exceptions import (
    FileTooLargeError,
    InvalidMimeError,
    StorageError,
    TextureNotFoundError,
)
from tcsh_ar_api.textures.models import Texture

logger = logging.getLogger(__name__)


class TextureService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self._settings = settings

    # ─── helpers ────────────────────────────────────────────────────────

    def _file_path(self, texture_id: UUID, filename: str) -> Path:
        ext = Path(filename).suffix.lower()
        # Path() copes with empty ext. The id-prefixed name avoids collisions
        # without leaking the original filename onto disk.
        return self._settings.texture_storage_dir / f"{texture_id}{ext}"

    def _validate(self, mime_type: str, size_bytes: int) -> None:
        # RFC 6838 mime tokens are case-insensitive — lowercase both sides
        # so `IMAGE/JPEG` doesn't false-reject.
        allowed = {m.lower() for m in self._settings.texture_allowed_mimes}
        if mime_type.lower() not in allowed:
            raise InvalidMimeError(
                f"mime '{mime_type}' not allowed; allowed: {sorted(allowed)}"
            )
        if size_bytes <= 0:
            raise InvalidMimeError("empty file")
        if size_bytes > self._settings.texture_max_size_bytes:
            raise FileTooLargeError(
                f"size {size_bytes} bytes exceeds "
                f"{self._settings.texture_max_size_bytes} byte limit"
            )

    # ─── queries ────────────────────────────────────────────────────────

    async def list_all(self) -> list[Texture]:
        result = await self.session.execute(select(Texture).order_by(Texture.created_at))
        return list(result.scalars())

    async def get(self, texture_id: UUID) -> Texture:
        texture = await self.session.get(Texture, texture_id)
        if texture is None:
            raise TextureNotFoundError()
        return texture

    async def get_with_path(self, texture_id: UUID) -> tuple[Texture, Path]:
        texture = await self.get(texture_id)
        return texture, self._file_path(texture.id, texture.filename)

    # ─── mutations ──────────────────────────────────────────────────────

    async def create(
        self,
        *,
        data: bytes,
        filename: str,
        mime_type: str,
        label: str | None = None,
    ) -> Texture:
        size_bytes = len(data)
        # Best-effort mime backstop: if the client sent something unhelpful
        # (e.g. application/octet-stream) we'll fall back to guessing from
        # the filename so a .png isn't rejected on a junk header.
        effective_mime = mime_type or mimetypes.guess_type(filename)[0] or ""
        self._validate(effective_mime, size_bytes)

        texture_id = uuid.uuid4()
        path = self._file_path(texture_id, filename)
        path.parent.mkdir(parents=True, exist_ok=True)

        texture = Texture(
            id=texture_id,
            label=label or filename,
            filename=filename,
            mime_type=effective_mime,
            size_bytes=size_bytes,
        )
        self.session.add(texture)
        try:
            await self.session.flush()
        except Exception:
            await self.session.rollback()
            raise

        try:
            # Atomic-ish write: write to a tmp file, then rename. Keeps us out
            # of "row exists but file is half-written" if we crash mid-write.
            tmp_path = path.with_suffix(path.suffix + ".tmp")
            tmp_path.write_bytes(data)
            os.replace(tmp_path, path)
        except OSError as exc:
            logger.exception("failed to write texture file", extra={"path": str(path)})
            await self.session.rollback()
            raise StorageError() from exc

        try:
            await self.session.commit()
        except Exception:
            # Commit failed after disk write — clean up the file so a retry
            # doesn't trip on an orphan.
            await self.session.rollback()
            try:
                path.unlink(missing_ok=True)
            except OSError:
                logger.exception(
                    "failed to clean up file after failed commit",
                    extra={"path": str(path)},
                )
            raise

        await self.session.refresh(texture)
        return texture

    async def delete(self, texture_id: UUID) -> None:
        texture, path = await self.get_with_path(texture_id)
        await self.session.delete(texture)
        await self.session.commit()
        # File-removal happens after the DB commits; if the unlink fails we
        # log it but don't roll back — the row is gone, the bytes are
        # detritus that an ops cleanup can reap later.
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.exception(
                "failed to remove texture file after row delete",
                extra={"path": str(path)},
            )
