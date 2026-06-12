"""Service-layer coverage for textures.

After the migration the texture service owns local-filesystem storage + DB
metadata (no more Supabase signed URLs). Tests run against the in-memory
SQLite session and a tmp storage dir, so a `create()` actually writes bytes
to disk and inserts a row. Magic-byte validation is exercised with real
file-signature payloads.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tcsh_ar_api.config import Settings
from tcsh_ar_api.textures.exceptions import (
    EmptyFileError,
    FileTooLargeError,
    InvalidMimeError,
)
from tcsh_ar_api.textures.service import TextureService

# Minimal payloads whose magic bytes the `filetype` library recognises.
_PNG = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + b"\x00" * 64
_JPEG = bytes([0xFF, 0xD8, 0xFF, 0xE0]) + b"\x00" * 64
_WEBP = b"RIFF" + (100).to_bytes(4, "little") + b"WEBPVP8 " + b"\x00" * 64


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        texture_allowed_mimes=["image/jpeg", "image/png", "image/webp"],
        texture_max_size_bytes=1024 * 1024,  # 1 MB
        texture_storage_dir=tmp_path / "textures",
    )


async def test_create_writes_file_and_inserts_row(db_session, settings: Settings) -> None:
    svc = TextureService(db_session, settings)
    texture = await svc.create(
        data=_PNG, filename="painting.png", mime_type="image/png", label="Painting"
    )

    assert texture.label == "Painting"
    assert texture.filename == "painting.png"
    assert texture.mime_type == "image/png"
    assert texture.size_bytes == len(_PNG)

    # Bytes actually landed on disk at the id-derived path.
    _, path = await svc.get_with_path(texture.id)
    assert path.exists()
    assert path.read_bytes() == _PNG


async def test_create_defaults_label_to_filename(db_session, settings: Settings) -> None:
    svc = TextureService(db_session, settings)
    texture = await svc.create(data=_JPEG, filename="x.jpg", mime_type="image/jpeg")
    assert texture.label == "x.jpg"


async def test_mime_whitelist_rejects_unsupported_type(
    db_session, settings: Settings
) -> None:
    svc = TextureService(db_session, settings)
    with pytest.raises(InvalidMimeError) as exc:
        await svc.create(data=b"<svg/>", filename="evil.svg", mime_type="image/svg+xml")
    assert exc.value.status_code == 415


async def test_mime_whitelist_is_case_insensitive(db_session, settings: Settings) -> None:
    """RFC 6838 declares mime tokens case-insensitive — `IMAGE/JPEG` must pass."""
    svc = TextureService(db_session, settings)
    texture = await svc.create(data=_JPEG, filename="x.jpg", mime_type="IMAGE/JPEG")
    assert texture.mime_type == "IMAGE/JPEG"


async def test_size_cap_rejects_oversized_file(db_session, settings: Settings) -> None:
    svc = TextureService(db_session, settings)
    oversized = _PNG[:8] + b"\x00" * (settings.texture_max_size_bytes + 1)
    with pytest.raises(FileTooLargeError) as exc:
        await svc.create(data=oversized, filename="huge.png", mime_type="image/png")
    assert exc.value.status_code == 413


async def test_empty_file_rejected(db_session, settings: Settings) -> None:
    svc = TextureService(db_session, settings)
    with pytest.raises(EmptyFileError) as exc:
        await svc.create(data=b"", filename="empty.png", mime_type="image/png")
    assert exc.value.status_code == 400


async def test_magic_byte_mismatch_rejected(db_session, settings: Settings) -> None:
    """A payload whose real content doesn't match the declared mime is rejected.

    The declared `image/png` header + `.png` extension are attacker-controlled;
    the actual bytes here are a JPEG, so the magic-byte check must reject it.
    """
    svc = TextureService(db_session, settings)
    with pytest.raises(InvalidMimeError):
        await svc.create(data=_JPEG, filename="liar.png", mime_type="image/png")


async def test_unidentifiable_content_rejected(db_session, settings: Settings) -> None:
    """Bytes the signature scanner can't identify are rejected, not stored."""
    svc = TextureService(db_session, settings)
    with pytest.raises(InvalidMimeError):
        await svc.create(data=b"not-an-image" * 8, filename="x.png", mime_type="image/png")


async def test_webp_round_trips(db_session, settings: Settings) -> None:
    svc = TextureService(db_session, settings)
    texture = await svc.create(data=_WEBP, filename="t.webp", mime_type="image/webp")
    assert texture.mime_type == "image/webp"


async def test_delete_removes_row_and_file(db_session, settings: Settings) -> None:
    svc = TextureService(db_session, settings)
    texture = await svc.create(data=_PNG, filename="p.png", mime_type="image/png")
    _, path = await svc.get_with_path(texture.id)
    assert path.exists()

    await svc.delete(texture.id)
    assert not path.exists()
    listed = await svc.list_all()
    assert all(t.id != texture.id for t in listed)
