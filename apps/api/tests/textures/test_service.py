"""Service-layer coverage for textures.

These tests only stand up a fake `SupabaseStorage` — the real one would
hit the network. Storage-side errors and the SDK key-shape fallbacks are
covered by `test_router.py` via the same fake.
"""

from __future__ import annotations

import base64
import json
import time
from unittest.mock import AsyncMock

import pytest

from tcsh_ar_api.config import Settings
from tcsh_ar_api.textures.exceptions import FileTooLargeError, InvalidMimeError
from tcsh_ar_api.textures.schemas import UploadURLRequest
from tcsh_ar_api.textures.service import TextureService, parse_token_exp
from tcsh_ar_api.textures.storage import SignedUpload


def _make_signed_upload(token: str = "fake.token.body") -> SignedUpload:
    return SignedUpload(
        upload_url="https://example.test/upload",
        storage_path="abc/def.webp",
        token=token,
    )


def _make_token(exp: int) -> str:
    """A non-validated JWT-shaped string carrying a known `exp`."""
    header = base64.urlsafe_b64encode(b'{"alg":"HS256"}').rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).rstrip(b"=").decode()
    return f"{header}.{payload}.signature"


@pytest.fixture
def settings() -> Settings:
    return Settings(
        texture_allowed_mimes=["image/jpeg", "image/png", "image/webp"],
        texture_max_size_bytes=1024 * 1024,  # 1 MB
    )


async def test_create_upload_url_happy_path(settings: Settings) -> None:
    storage = AsyncMock()
    expected_exp = int(time.time()) + 3600
    storage.create_upload_url.return_value = _make_signed_upload(_make_token(expected_exp))

    svc = TextureService(storage, settings)
    response = await svc.create_upload_url(
        UploadURLRequest(filename="painting.webp", mime="image/webp", size_bytes=2048)
    )
    assert response.upload_url == "https://example.test/upload"
    assert response.storage_path == "abc/def.webp"
    assert response.expires_at == expected_exp
    storage.create_upload_url.assert_awaited_once_with("painting.webp")


async def test_mime_whitelist_rejects_unsupported_type(settings: Settings) -> None:
    storage = AsyncMock()
    svc = TextureService(storage, settings)
    with pytest.raises(InvalidMimeError) as exc:
        await svc.create_upload_url(
            UploadURLRequest(filename="evil.svg", mime="image/svg+xml", size_bytes=10)
        )
    assert exc.value.status_code == 415
    storage.create_upload_url.assert_not_called()


async def test_mime_whitelist_is_case_insensitive(settings: Settings) -> None:
    """RFC 6838 declares mime tokens case-insensitive — `IMAGE/JPEG` must pass."""
    storage = AsyncMock()
    storage.create_upload_url.return_value = _make_signed_upload(_make_token(0))
    svc = TextureService(storage, settings)
    response = await svc.create_upload_url(
        UploadURLRequest(filename="x.jpg", mime="IMAGE/JPEG", size_bytes=10)
    )
    assert response.upload_url == "https://example.test/upload"


async def test_size_cap_rejects_oversized_file(settings: Settings) -> None:
    storage = AsyncMock()
    svc = TextureService(storage, settings)
    with pytest.raises(FileTooLargeError) as exc:
        await svc.create_upload_url(
            UploadURLRequest(
                filename="huge.png",
                mime="image/png",
                size_bytes=settings.texture_max_size_bytes + 1,
            )
        )
    assert exc.value.status_code == 413
    storage.create_upload_url.assert_not_called()


async def testparse_token_exp_extracts_known_value() -> None:
    expected = 1_750_000_000
    assert parse_token_exp(_make_token(expected)) == expected


def testparse_token_exp_falls_back_for_non_jwt() -> None:
    """Non-JWT-shaped strings fall back to now + 2h instead of raising."""
    before = int(time.time())
    fallback = parse_token_exp("not-a-jwt")
    after = int(time.time())
    # Default fallback is 7200s; allow ±2s slack for assertion stability.
    assert before + 7200 - 2 <= fallback <= after + 7200 + 2


def testparse_token_exp_falls_back_for_jwt_without_exp() -> None:
    header = base64.urlsafe_b64encode(b'{"alg":"HS256"}').rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(b'{"sub":"abc"}').rstrip(b"=").decode()
    token = f"{header}.{payload}.sig"

    fallback = parse_token_exp(token)
    assert fallback > int(time.time())  # at least in the future


def testparse_token_exp_falls_back_for_malformed_payload() -> None:
    """Garbage in the JWT body must not crash; the comment in the source
    promises a fallback for `(ValueError, KeyError, TypeError)`."""
    token = "header.NOT-VALID-BASE64!@#.sig"
    fallback = parse_token_exp(token)
    assert fallback > int(time.time())
