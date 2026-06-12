"""Coverage for `auth.dependencies.get_current_admin` / `require_admin`.

These tests stand up a tiny FastAPI app with the dependency wired in
directly — the main app's overrides (in `tests/conftest.py`) bypass the real
dependency, so they can't exercise these branches.

Single-admin model: there is one admin identity, configured from Settings.
A valid HS256 JWT (minted by `auth.service.mint_token`) resolves to that
admin; every other case — missing header, non-Bearer scheme, empty token,
expired/forged/garbage token — is rejected with 401 and a `WWW-Authenticate:
Bearer` challenge. There is no authenticated *non-admin* identity and hence
no 403 role-gate (that was a Supabase two-tier artifact).
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator

import jwt as pyjwt
import pytest
import pytest_asyncio
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from tcsh_ar_api.auth.dependencies import get_current_admin, require_admin
from tcsh_ar_api.auth.schemas import LocalUser
from tcsh_ar_api.auth.service import mint_token
from tcsh_ar_api.config import Settings, get_settings

_SECRET = "test-secret-32-bytes-pad-pad-pad-pad"


@pytest.fixture
def settings() -> Settings:
    return Settings(
        jwt_secret=SecretStr(_SECRET),
        admin_email="admin@example.test",
        admin_password_hash="",
        jwt_expires_seconds=3600,
    )


@pytest_asyncio.fixture
async def auth_app(settings: Settings) -> AsyncIterator[FastAPI]:
    app = FastAPI()

    @app.get("/whoami")
    async def whoami(
        user: LocalUser = Depends(get_current_admin),  # noqa: B008 — FastAPI idiom
    ) -> dict[str, object]:
        return user.model_dump()

    @app.get("/admin-only")
    async def admin_only(
        user: LocalUser = Depends(require_admin),  # noqa: B008 — FastAPI idiom
    ) -> dict[str, object]:
        return user.model_dump()

    app.dependency_overrides[get_settings] = lambda: settings
    yield app
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def auth_client(auth_app: FastAPI) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=auth_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def _admin_token(settings: Settings) -> str:
    return mint_token(settings.admin_email, settings=settings)


# ── get_current_admin ─────────────────────────────────────────────────────


async def test_missing_authorization_header_returns_401(auth_client: AsyncClient) -> None:
    response = await auth_client.get("/whoami")
    assert response.status_code == 401
    assert response.json()["detail"] == "missing bearer token"
    assert response.headers["www-authenticate"].lower().startswith("bearer")


async def test_malformed_authorization_scheme_returns_401(auth_client: AsyncClient) -> None:
    """Anything other than `Bearer <token>` is rejected by the bearer scheme.

    HTTPBearer with auto_error=False rejects non-Bearer schemes by yielding
    None — handled by the same branch as a missing header.
    """
    response = await auth_client.get(
        "/whoami", headers={"Authorization": "Basic abcdef"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "missing bearer token"


async def test_empty_bearer_token_returns_401(auth_client: AsyncClient) -> None:
    response = await auth_client.get(
        "/whoami", headers={"Authorization": "Bearer "}
    )
    assert response.status_code == 401


async def test_invalid_token_surfaces_with_detail(auth_client: AsyncClient) -> None:
    """A garbage token must surface as 401 with a detail (not a 500)."""
    response = await auth_client.get(
        "/whoami", headers={"Authorization": "Bearer not-a-jwt-at-all"}
    )
    assert response.status_code == 401
    assert response.json()["detail"]
    assert response.headers["www-authenticate"].lower().startswith("bearer")


async def test_expired_token_surfaces_as_401(
    auth_client: AsyncClient,
    settings: Settings,
) -> None:
    """An expired token is rejected at the dependency boundary, not 500'd."""
    now = int(time.time())
    expired = pyjwt.encode(
        {"sub": settings.admin_email, "email": settings.admin_email,
         "is_admin": True, "iat": now - 120, "exp": now - 60},
        _SECRET,
        algorithm="HS256",
    )
    response = await auth_client.get(
        "/whoami", headers={"Authorization": f"Bearer {expired}"}
    )
    assert response.status_code == 401


async def test_valid_token_resolves_to_admin(
    auth_client: AsyncClient,
    settings: Settings,
) -> None:
    response = await auth_client.get(
        "/whoami", headers={"Authorization": f"Bearer {_admin_token(settings)}"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "admin@example.test"
    assert body["is_admin"] is True


async def test_token_signed_with_wrong_secret_rejected(auth_client: AsyncClient) -> None:
    """A token forged under a different secret must not resolve to the admin."""
    now = int(time.time())
    forged = pyjwt.encode(
        {"sub": "admin@example.test", "email": "admin@example.test",
         "is_admin": True, "iat": now, "exp": now + 3600},
        "a-totally-different-secret-padding-pad",
        algorithm="HS256",
    )
    response = await auth_client.get(
        "/whoami", headers={"Authorization": f"Bearer {forged}"}
    )
    assert response.status_code == 401


# ── require_admin ──────────────────────────────────────────────────────────


async def test_admin_route_rejects_anonymous(auth_client: AsyncClient) -> None:
    response = await auth_client.get("/admin-only")
    assert response.status_code == 401


async def test_admin_route_rejects_garbage_token(auth_client: AsyncClient) -> None:
    """The single-admin model has no non-admin identity — a token that can't
    be verified is rejected with 401 (the closest analog of the old 403)."""
    response = await auth_client.get(
        "/admin-only", headers={"Authorization": "Bearer x.y.z"}
    )
    assert response.status_code == 401
    assert response.headers["www-authenticate"].lower().startswith("bearer")


async def test_admin_route_admits_admin(
    auth_client: AsyncClient,
    settings: Settings,
) -> None:
    response = await auth_client.get(
        "/admin-only", headers={"Authorization": f"Bearer {_admin_token(settings)}"}
    )
    assert response.status_code == 200
    assert response.json()["is_admin"] is True


# ── Sanity ─────────────────────────────────────────────────────────────────


def test_require_admin_is_get_current_admin() -> None:
    """`require_admin` is kept as an alias of `get_current_admin` so existing
    route deps keep importing it. Pin that the alias stays intact."""
    assert require_admin is get_current_admin
