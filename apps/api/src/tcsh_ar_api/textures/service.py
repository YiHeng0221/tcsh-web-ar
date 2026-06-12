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

import filetype  # type: ignore[import-untyped]
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tcsh_ar_api.config import Settings
from tcsh_ar_api.textures.exceptions import (
    EmptyFileError,
    FileTooLargeError,
    InvalidMimeError,
    StorageError,
    TextureNotFoundError,
)
from tcsh_ar_api.textures.models import Texture

logger = logging.getLogger(__name__)

# KTX2 identifier per the Khronos spec §3.1 — the 12-byte file signature
# `«KTX 20»\r\n\x1a\n`. `filetype` (v1.x) can't detect ktx2, so uploads
# declaring image/ktx2 are checked against this manually in _validate.
_KTX2_MAGIC = b"\xabKTX 20\xbb\r\n\x1a\n"


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

    def _validate(self, mime_type: str, size_bytes: int, data: bytes) -> None:
        # RFC 6838 mime tokens are case-insensitive — lowercase both sides
        # so `IMAGE/JPEG` doesn't false-reject.
        allowed = {m.lower() for m in self._settings.texture_allowed_mimes}
        if mime_type.lower() not in allowed:
            raise InvalidMimeError(
                f"mime '{mime_type}' not allowed; allowed: {sorted(allowed)}"
            )
        if size_bytes <= 0:
            raise EmptyFileError()
        if size_bytes > self._settings.texture_max_size_bytes:
            raise FileTooLargeError(
                f"size {size_bytes} bytes exceeds "
                f"{self._settings.texture_max_size_bytes} byte limit"
            )

        # Magic-bytes verification: reject uploads whose actual content does
        # not match the declared mime type. The HTTP Content-Type header and
        # the filename extension are both attacker-controlled, so a client
        # can trivially bypass an allow-list that only inspects those fields.
        # `filetype` reads the first few bytes of the payload and matches
        # against known magic-number signatures without any C extension.
        #
        # image/ktx2 is a KhronosGroup format with the magic bytes
        # `«KTX 20»\r\n\x1a\n`. The `filetype` library does not recognise it
        # (v1.x), so we verify the KTX2 signature manually — otherwise a
        # client could upload arbitrary bytes under a declared image/ktx2
        # mime and bypass content validation entirely.
        # All other allowed mimes (jpeg, png, webp) are covered by filetype.
        if mime_type.lower() == "image/ktx2":
            if not data.startswith(_KTX2_MAGIC):
                raise InvalidMimeError(
                    "file content is not a valid KTX2 texture "
                    "(KTX 20 signature missing)"
                )
        else:
            detected = filetype.guess_mime(data)
            if detected is None:
                raise InvalidMimeError(
                    f"file content could not be identified; "
                    f"expected one of {sorted(allowed)}"
                )
            if detected.lower() != mime_type.lower():
                raise InvalidMimeError(
                    f"file content detected as '{detected}' does not match "
                    f"declared mime '{mime_type}'"
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
        self._validate(effective_mime, size_bytes, data)

        texture_id = uuid.uuid4()
        path = self._file_path(texture_id, filename)
        # Same StorageError contract as the write below — a mkdir failure
        # (read-only volume, permission) should surface as a storage
        # problem, not an unhandled 500.
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise StorageError() from exc

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
