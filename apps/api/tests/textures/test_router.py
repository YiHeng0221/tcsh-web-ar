"""Router-level coverage for the textures domain.

After the migration the texture router streams a multipart upload through
`POST /textures` (admin-only), persists the bytes to the local filesystem,
and serves them back at `GET /textures/{id}/file`. These tests run against
the in-memory SQLite session (via the shared `client` fixture) with the
texture storage dir pointed at a tmp path so real bytes land on disk.

Auth is the single-admin model: a valid admin token (the conftest default)
passes; a token that doesn't resolve to the admin or a missing token is
rejected with 401 — there is no separate 403 role gate.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from tcsh_ar_api.config import Settings, get_settings

# Minimal payloads whose magic bytes the `filetype` library recognises.
_PNG = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + b"\x00" * 64
_JPEG = bytes([0xFF, 0xD8, 0xFF, 0xE0]) + b"\x00" * 64


@pytest.fixture
def storage_settings(app: FastAPI, tmp_path: Path) -> Iterator[Settings]:
    """Override `get_settings` so uploads write into a tmp dir with a known
    allow-list / size cap. Restored on teardown so other tests aren't polluted.
    """
    settings = Settings(
        texture_allowed_mimes=["image/jpeg", "image/png", "image/webp"],
        texture_max_size_bytes=1024 * 1024,
        texture_storage_dir=tmp_path / "textures",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


async def test_upload_happy_path(
    client: AsyncClient, storage_settings: Settings
) -> None:
    response = await client.post(
        "/textures",
        files={"file": ("painting.png", _PNG, "image/png")},
        data={"label": "Painting"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["label"] == "Painting"
    assert body["filename"] == "painting.png"
    assert body["mime_type"] == "image/png"
    assert body["size_bytes"] == len(_PNG)
    assert body["file_url"] == f"/textures/{body['id']}/file"

    # The served file round-trips the original bytes.
    fetched = await client.get(body["file_url"])
    assert fetched.status_code == 200
    assert fetched.content == _PNG


async def test_unsupported_mime_returns_415(
    client: AsyncClient, storage_settings: Settings
) -> None:
    response = await client.post(
        "/textures",
        files={"file": ("evil.svg", b"<svg/>", "image/svg+xml")},
    )
    assert response.status_code == 415


async def test_oversized_file_returns_413(
    client: AsyncClient, storage_settings: Settings
) -> None:
    huge = _PNG[:8] + b"\x00" * (storage_settings.texture_max_size_bytes + 1)
    response = await client.post(
        "/textures",
        files={"file": ("huge.png", huge, "image/png")},
    )
    assert response.status_code == 413


async def test_empty_file_returns_400(
    client: AsyncClient, storage_settings: Settings
) -> None:
    response = await client.post(
        "/textures",
        files={"file": ("empty.png", b"", "image/png")},
    )
    assert response.status_code == 400


async def test_magic_byte_mismatch_returns_415(
    client: AsyncClient, storage_settings: Settings
) -> None:
    """Declared `image/png` but the bytes are a JPEG — must be rejected."""
    response = await client.post(
        "/textures",
        files={"file": ("liar.png", _JPEG, "image/png")},
    )
    assert response.status_code == 415


async def test_upload_rejects_non_admin_token(
    client: AsyncClient,
    storage_settings: Settings,
    as_regular: Callable[[], None],
) -> None:
    """Single-admin model: a token that doesn't resolve to the admin → 401."""
    as_regular()
    response = await client.post(
        "/textures",
        files={"file": ("x.png", _PNG, "image/png")},
    )
    assert response.status_code == 401


async def test_upload_requires_token(
    client: AsyncClient,
    storage_settings: Settings,
    as_anonymous: Callable[[], None],
) -> None:
    as_anonymous()
    response = await client.post(
        "/textures",
        files={"file": ("x.png", _PNG, "image/png")},
    )
    assert response.status_code == 401
    assert response.headers.get("www-authenticate", "").lower().startswith("bearer")


async def test_list_is_publicly_readable(
    client: AsyncClient,
    storage_settings: Settings,
    as_anonymous: Callable[[], None],
) -> None:
    """Reads aren't behind require_admin — anonymous list is fine."""
    as_anonymous()
    response = await client.get("/textures")
    assert response.status_code == 200
    assert response.json() == []


async def test_get_unknown_texture_returns_404(
    client: AsyncClient, storage_settings: Settings
) -> None:
    from uuid import uuid4

    response = await client.get(f"/textures/{uuid4()}")
    assert response.status_code == 404


# glTF binary container magic — first 4 bytes of every .glb.
_GLB = b"glTF" + bytes([0x02, 0, 0, 0]) + b"\x00" * 64


@pytest.fixture
def glb_settings(app: FastAPI, tmp_path: Path) -> Iterator[Settings]:
    settings = Settings(
        texture_allowed_mimes=["image/png", "model/gltf-binary"],
        texture_max_size_bytes=1024 * 1024,
        texture_storage_dir=tmp_path / "textures",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


async def test_upload_glb_texture_kind_model(
    client: AsyncClient, glb_settings: Settings
) -> None:
    """A glb upload passes magic-byte validation and reports kind=model."""
    res = await client.post(
        "/textures",
        files={"file": ("panel.glb", _GLB, "model/gltf-binary")},
        data={"label": "3D panel"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["mime_type"] == "model/gltf-binary"
    assert body["kind"] == "model"


async def test_upload_glb_bad_magic_rejected(
    client: AsyncClient, glb_settings: Settings
) -> None:
    """Arbitrary bytes declared as glb are rejected by the magic check."""
    res = await client.post(
        "/textures",
        files={"file": ("fake.glb", b"NOTGLTF" + b"\x00" * 64, "model/gltf-binary")},
        data={"label": "fake"},
    )
    # InvalidMimeError maps to 415 (same as a disallowed mime / bad ktx2).
    assert res.status_code == 415, res.text


async def test_png_kind_image(client: AsyncClient, glb_settings: Settings) -> None:
    res = await client.post(
        "/textures",
        files={"file": ("p.png", _PNG, "image/png")},
        data={"label": "flat"},
    )
    assert res.status_code == 201, res.text
    assert res.json()["kind"] == "image"
