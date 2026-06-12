"""End-to-end tests for the auth router (POST /auth/login, GET /auth/me).

Uses FastAPI's TestClient so the dependency-injection wiring (Settings,
HTTPBearer, JWT verify) is exercised at the same surface a real client hits.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from tcsh_ar_api.auth.service import hash_password
from tcsh_ar_api.config import Settings, get_settings
from tcsh_ar_api.main import app


@pytest.fixture
def admin_settings() -> Settings:
    return Settings(
        jwt_secret=SecretStr("test-secret-32-bytes-pad-pad-pad-pad"),
        admin_email="admin@example.test",
        admin_password_hash=hash_password("admin1234"),
        jwt_expires_seconds=3600,
    )


@pytest.fixture
def client(admin_settings: Settings) -> Iterator[TestClient]:
    """A TestClient with the get_settings() dependency overridden to a known
    admin. The override is removed on teardown so other tests aren't polluted.
    """
    app.dependency_overrides[get_settings] = lambda: admin_settings
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_settings, None)


def test_login_succeeds_with_correct_credentials(client: TestClient) -> None:
    resp = client.post(
        "/auth/login",
        json={"email": "admin@example.test", "password": "admin1234"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["token_type"] == "bearer"
    assert data["expires_in"] == 3600
    assert isinstance(data["access_token"], str)
    assert len(data["access_token"]) > 0


def test_login_rejects_wrong_password(client: TestClient) -> None:
    resp = client.post(
        "/auth/login",
        json={"email": "admin@example.test", "password": "wrong-password"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid credentials"


def test_login_rejects_unknown_email(client: TestClient) -> None:
    resp = client.post(
        "/auth/login",
        json={"email": "nobody@example.test", "password": "admin1234"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid credentials"


def test_me_requires_bearer_token(client: TestClient) -> None:
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_me_returns_admin_after_login(client: TestClient) -> None:
    login = client.post(
        "/auth/login",
        json={"email": "admin@example.test", "password": "admin1234"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    resp = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "admin@example.test"
    assert body["is_admin"] is True


def test_me_rejects_garbage_token(client: TestClient) -> None:
    resp = client.get(
        "/auth/me",
        headers={"Authorization": "Bearer not-a-jwt"},
    )
    assert resp.status_code == 401
