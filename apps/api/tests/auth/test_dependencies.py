"""Coverage for `auth.dependencies.get_current_user` and `require_admin`.

These tests stand up a tiny FastAPI app with the dependencies wired in
directly — the main app's overrides (in `tests/conftest.py`) bypass the
real dependencies, so they can't exercise these branches.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from tcsh_ar_api.auth.dependencies import get_current_user, require_admin
from tcsh_ar_api.auth.exceptions import InvalidTokenError
from tcsh_ar_api.auth.schemas import CurrentUser, TokenClaims
from tcsh_ar_api.auth.service import JWTService, get_jwt_service


class _FakeJWTService:
    """Fake JWTService that returns a configurable verify() outcome.

    We can't use AsyncMock here because the dependency type-hint pins
    JWTService and FastAPI will resolve it via dependency_overrides
    regardless of class as long as we override `get_jwt_service`.
    """

    def __init__(self) -> None:
        # Default: every token verifies as a non-admin user.
        self._claims_factory: Any = lambda: TokenClaims(
            sub="user-1",
            aud="authenticated",
            exp=9_999_999_999,
            email="user@example.test",
        )

    def returns(self, claims: TokenClaims) -> None:
        self._claims_factory = lambda: claims

    def raises(self, exc: Exception) -> None:
        def _raise() -> TokenClaims:
            raise exc

        self._claims_factory = _raise

    async def verify(self, _token: str) -> TokenClaims:
        return self._claims_factory()


@pytest.fixture
def fake_jwt_service() -> _FakeJWTService:
    return _FakeJWTService()


@pytest_asyncio.fixture
async def auth_app(fake_jwt_service: _FakeJWTService) -> AsyncIterator[FastAPI]:
    app = FastAPI()

    @app.get("/whoami")
    async def whoami(
        user: CurrentUser = Depends(get_current_user),  # noqa: B008 — FastAPI idiom
    ) -> dict[str, Any]:
        return user.model_dump()

    @app.get("/admin-only")
    async def admin_only(
        user: CurrentUser = Depends(require_admin),  # noqa: B008 — FastAPI idiom
    ) -> dict[str, Any]:
        return user.model_dump()

    app.dependency_overrides[get_jwt_service] = lambda: fake_jwt_service
    yield app
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def auth_client(auth_app: FastAPI) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=auth_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ── get_current_user ──────────────────────────────────────────────────────


async def test_missing_authorization_header_returns_401(auth_client: AsyncClient) -> None:
    response = await auth_client.get("/whoami")
    assert response.status_code == 401
    assert response.json()["detail"] == "missing bearer token"
    assert response.headers["www-authenticate"].lower().startswith("bearer")


async def test_malformed_authorization_scheme_returns_401(auth_client: AsyncClient) -> None:
    """Anything other than `Bearer <token>` should be rejected by the bearer scheme.

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


async def test_invalid_token_surfaces_with_detail(
    auth_client: AsyncClient,
    fake_jwt_service: _FakeJWTService,
) -> None:
    """`InvalidTokenError.detail` must be propagated verbatim so the client
    learns *why* (expired vs. wrong audience vs. unknown kid)."""
    fake_jwt_service.raises(InvalidTokenError("expired token"))
    response = await auth_client.get(
        "/whoami", headers={"Authorization": "Bearer abc.def.ghi"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "expired token"
    assert response.headers["www-authenticate"].lower().startswith("bearer")


async def test_bad_audience_surfaces_as_401(
    auth_client: AsyncClient,
    fake_jwt_service: _FakeJWTService,
) -> None:
    fake_jwt_service.raises(InvalidTokenError("Invalid audience"))
    response = await auth_client.get(
        "/whoami", headers={"Authorization": "Bearer x.y.z"}
    )
    assert response.status_code == 401
    assert "audience" in response.json()["detail"].lower()


async def test_valid_token_resolves_to_non_admin_user(auth_client: AsyncClient) -> None:
    response = await auth_client.get(
        "/whoami", headers={"Authorization": "Bearer x.y.z"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "user-1"
    assert body["email"] == "user@example.test"
    assert body["is_admin"] is False


async def test_admin_role_in_app_metadata_promotes_user(
    auth_client: AsyncClient,
    fake_jwt_service: _FakeJWTService,
) -> None:
    """Only `app_metadata.role == "admin"` flips `is_admin`; user_metadata
    role is intentionally NOT consulted (users can write to user_metadata)."""
    fake_jwt_service.returns(
        TokenClaims(
            sub="admin-1",
            aud="authenticated",
            exp=9_999_999_999,
            email="admin@example.test",
            app_metadata={"role": "admin"},
        )
    )
    response = await auth_client.get(
        "/whoami", headers={"Authorization": "Bearer x.y.z"}
    )
    assert response.status_code == 200
    assert response.json()["is_admin"] is True


async def test_user_metadata_role_does_not_grant_admin(
    auth_client: AsyncClient,
    fake_jwt_service: _FakeJWTService,
) -> None:
    """A user-supplied `user_metadata.role=admin` MUST NOT promote them."""
    fake_jwt_service.returns(
        TokenClaims(
            sub="impostor-1",
            aud="authenticated",
            exp=9_999_999_999,
            email="hacker@example.test",
            user_metadata={"role": "admin"},
        )
    )
    response = await auth_client.get(
        "/whoami", headers={"Authorization": "Bearer x.y.z"}
    )
    assert response.status_code == 200
    assert response.json()["is_admin"] is False


# ── require_admin ──────────────────────────────────────────────────────────


async def test_admin_route_rejects_anonymous(auth_client: AsyncClient) -> None:
    response = await auth_client.get("/admin-only")
    assert response.status_code == 401


async def test_admin_route_rejects_non_admin_with_403(auth_client: AsyncClient) -> None:
    response = await auth_client.get(
        "/admin-only", headers={"Authorization": "Bearer x.y.z"}
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "admin required"


async def test_admin_route_admits_admin(
    auth_client: AsyncClient,
    fake_jwt_service: _FakeJWTService,
) -> None:
    fake_jwt_service.returns(
        TokenClaims(
            sub="admin-1",
            aud="authenticated",
            exp=9_999_999_999,
            app_metadata={"role": "admin"},
        )
    )
    response = await auth_client.get(
        "/admin-only", headers={"Authorization": "Bearer x.y.z"}
    )
    assert response.status_code == 200
    assert response.json()["is_admin"] is True


# ── Sanity ─────────────────────────────────────────────────────────────────


def test_jwt_service_factory_is_lru_cached() -> None:
    """`get_jwt_service` uses lru_cache(1); cache_clear must be safe to call.

    Tests rely on `cache_clear()` between runs in case env vars change.
    Pinning that the symbol is intact so a future refactor doesn't silently
    break the contract.
    """
    assert hasattr(get_jwt_service, "cache_clear")
    get_jwt_service.cache_clear()
    assert callable(get_jwt_service)
    assert JWTService.__name__ == "JWTService"
