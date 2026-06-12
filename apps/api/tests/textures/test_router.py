"""Router-level coverage for the textures domain.

The texture router doesn't touch the DB — it brokers a Supabase Storage
signed URL. We override `get_storage` with a fake to keep the test
hermetic; status-code paths are the contract under test.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from unittest.mock import AsyncMock

import pytest_asyncio
from fastapi import FastAPI
from httpx import AsyncClient

from tcsh_ar_api.textures.exceptions import StorageError
from tcsh_ar_api.textures.storage import SignedUpload, get_storage


def _make_signed_upload() -> SignedUpload:
    return SignedUpload(
        upload_url="https://example.test/storage/signed/abc",
        storage_path="abc/def.webp",
        token="header.payload.signature",
    )


@pytest_asyncio.fixture
async def storage_mock(app: FastAPI) -> AsyncIterator[AsyncMock]:
    """Override the `get_storage` dependency with an AsyncMock for the test."""
    mock = AsyncMock()
    mock.create_upload_url.return_value = _make_signed_upload()

    def _override() -> AsyncMock:
        return mock

    app.dependency_overrides[get_storage] = _override
    try:
        yield mock
    finally:
        app.dependency_overrides.pop(get_storage, None)


async def test_create_upload_url_happy_path(
    client: AsyncClient,
    storage_mock: AsyncMock,
) -> None:
    response = await client.post(
        "/textures/upload-url",
        json={"filename": "painting.webp", "mime": "image/webp", "size_bytes": 2048},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["upload_url"].startswith("https://")
    assert body["storage_path"] == "abc/def.webp"
    assert body["token"] == "header.payload.signature"
    assert isinstance(body["expires_at"], int)
    storage_mock.create_upload_url.assert_awaited_once_with("painting.webp")


async def test_unsupported_mime_returns_415(
    client: AsyncClient,
    storage_mock: AsyncMock,
) -> None:
    response = await client.post(
        "/textures/upload-url",
        json={"filename": "evil.svg", "mime": "image/svg+xml", "size_bytes": 10},
    )
    assert response.status_code == 415
    storage_mock.create_upload_url.assert_not_called()


async def test_oversized_file_returns_413(
    client: AsyncClient,
    storage_mock: AsyncMock,
) -> None:
    huge = 50 * 1024 * 1024
    response = await client.post(
        "/textures/upload-url",
        json={"filename": "huge.png", "mime": "image/png", "size_bytes": huge},
    )
    assert response.status_code == 413
    storage_mock.create_upload_url.assert_not_called()


async def test_requires_admin(
    client: AsyncClient,
    storage_mock: AsyncMock,
    as_regular: Callable[[], None],
) -> None:
    as_regular()
    response = await client.post(
        "/textures/upload-url",
        json={"filename": "x.png", "mime": "image/png", "size_bytes": 10},
    )
    assert response.status_code == 403


async def test_requires_token(
    client: AsyncClient,
    storage_mock: AsyncMock,
    as_anonymous: Callable[[], None],
) -> None:
    as_anonymous()
    response = await client.post(
        "/textures/upload-url",
        json={"filename": "x.png", "mime": "image/png", "size_bytes": 10},
    )
    assert response.status_code == 401
    assert response.headers.get("www-authenticate", "").lower().startswith("bearer")


async def test_storage_failure_returns_502(
    client: AsyncClient,
    storage_mock: AsyncMock,
) -> None:
    """When the Supabase SDK raises (or returns malformed shape), the API surfaces
    a 502 with a generic detail — no SDK leakage."""
    storage_mock.create_upload_url.side_effect = StorageError()
    response = await client.post(
        "/textures/upload-url",
        json={"filename": "x.png", "mime": "image/png", "size_bytes": 10},
    )
    assert response.status_code == 502
    # `StorageError` default detail must surface verbatim — sensitive details
    # from the SDK should NOT have been threaded through.
    assert response.json()["detail"] == "storage backend error"


async def test_validation_rejects_empty_filename(
    client: AsyncClient,
    storage_mock: AsyncMock,
) -> None:
    response = await client.post(
        "/textures/upload-url",
        json={"filename": "", "mime": "image/png", "size_bytes": 10},
    )
    assert response.status_code == 422


async def test_validation_rejects_non_positive_size(
    client: AsyncClient,
    storage_mock: AsyncMock,
) -> None:
    response = await client.post(
        "/textures/upload-url",
        json={"filename": "x.png", "mime": "image/png", "size_bytes": 0},
    )
    assert response.status_code == 422
