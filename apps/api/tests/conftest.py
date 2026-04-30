"""Shared pytest fixtures for the FastAPI test suite.

Strategy
--------
Tests that touch the DB run against a real Postgres spun up once per session
via testcontainers. After each test we TRUNCATE every mutable domain table
so the next test starts clean. We tried the nested-SAVEPOINT pattern (each
test joining an outer rollback-only transaction) — it falls apart under the
service layer's `commit()` calls because the asyncpg dialect surfaces
"MissingGreenlet" when SAVEPOINTs cycle outside the async greenlet context.
TRUNCATE is the boring-but-reliable choice; the suite still runs in seconds.

Mocking the DB was rejected for two reasons:

1. The integrity classifiers in `*/service.py` branch on asyncpg-specific
   `sqlstate` values; SQLite would not surface those at all.
2. JSONB columns (`anchors.world_pos`, `placements.transform`) are part of
   the wire contract — we want round-tripping through real Postgres.

Auth fixtures override `get_current_user` / `require_admin` directly; we
don't try to mint real Supabase JWTs. The JWT verification path itself is
covered by `tests/auth/test_jwt_service.py` and `test_dependencies.py`.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator, AsyncIterator, Callable, Generator
from typing import Any
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text as _text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from testcontainers.postgres import PostgresContainer

# Auth env must be in place before tcsh_ar_api.config caches Settings — the
# import of `main` triggers `get_jwt_service()` in the lifespan, which checks
# these. They're only read at boot; the JWT path is fully overridden below.
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.test")
os.environ.setdefault(
    "SUPABASE_JWKS_URL",
    "https://test.supabase.test/auth/v1/.well-known/jwks.json",
)
os.environ.setdefault("SUPABASE_SECRET_KEY", "sb_secret_test_only")
os.environ.setdefault("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_only")


@pytest.fixture(scope="session")
def postgres_container() -> Generator[PostgresContainer, None, None]:
    """One shared Postgres for the whole test run.

    asyncpg needs the URL scheme rewritten — testcontainers hands back a
    psycopg2-style `postgresql+psycopg2://` URL by default.
    """
    container = PostgresContainer("postgres:16-alpine", driver=None)
    with container as pg:
        yield pg


@pytest.fixture(scope="session")
def database_url(postgres_container: PostgresContainer) -> str:
    raw = postgres_container.get_connection_url()
    # `get_connection_url` returns either `postgresql://...` or
    # `postgresql+psycopg2://...` depending on testcontainers version.
    if raw.startswith("postgresql+"):
        _, rest = raw.split("://", 1)
        return f"postgresql+asyncpg://{rest}"
    return raw.replace("postgresql://", "postgresql+asyncpg://", 1)


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def engine(database_url: str) -> AsyncIterator[Any]:
    """Engine bound to the test container; schema is created once per session."""
    # Late import so the SUPABASE_* env defaults above land in Settings before
    # `tcsh_ar_api.db.session` evaluates `_settings.database_url`.
    from tcsh_ar_api.db import models as _models  # noqa: F401 — register mappers
    from tcsh_ar_api.db.base import Base

    test_engine = create_async_engine(database_url, future=True)
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield test_engine
    finally:
        await test_engine.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def db_session(engine: Any) -> AsyncIterator[AsyncSession]:
    """One AsyncSession per test, isolated by truncating mutable tables on teardown.

    A nested-savepoint pattern is the prettier choice in theory, but
    SQLAlchemy 2.0's asyncpg dialect frequently trips on "MissingGreenlet"
    when a service-layer `commit()` releases a SAVEPOINT and the next
    statement tries to re-open one through the same connection. Truncating
    on teardown is slower per test (a TRUNCATE per domain table) but is
    the only approach that worked reliably under asyncpg + commit()-heavy
    services. Test runtime is still under a few seconds.
    """
    # SQLAlchemy convention: PascalCase for the session factory itself,
    # snake_case for instances. Mirrors `db.session.SessionLocal` in src.
    SessionLocal = async_sessionmaker(  # noqa: N806
        bind=engine,
        expire_on_commit=False,
    )
    async with SessionLocal() as session:
        try:
            yield session
        finally:
            await session.rollback()
            # Order matters: placements FK-references everything else.
            await session.execute(
                _text(
                    "TRUNCATE TABLE placements, ar_objects, anchors, textures "
                    "RESTART IDENTITY CASCADE"
                )
            )
            await session.commit()


# ── Auth identity fixtures ────────────────────────────────────────────────
# `current_user` is the role the route sees once `get_current_user` /
# `require_admin` are overridden. Default is admin so happy-path tests don't
# have to opt in; tests that exercise the auth gate flip it explicitly.


@pytest.fixture
def admin_user() -> dict[str, Any]:
    from tcsh_ar_api.auth.schemas import CurrentUser

    return CurrentUser(
        id=str(uuid4()),
        email="admin@example.test",
        is_admin=True,
    ).model_dump()


@pytest.fixture
def regular_user() -> dict[str, Any]:
    from tcsh_ar_api.auth.schemas import CurrentUser

    return CurrentUser(
        id=str(uuid4()),
        email="user@example.test",
        is_admin=False,
    ).model_dump()


@pytest.fixture
def auth_state() -> dict[str, Any]:
    """Mutable holder so individual tests can flip the active user mid-test."""
    return {"user": None}


@pytest_asyncio.fixture(loop_scope="session")
async def app(
    db_session: AsyncSession,
    auth_state: dict[str, Any],
    admin_user: dict[str, Any],
) -> AsyncIterator[FastAPI]:
    """A FastAPI app instance with DB and auth dependencies overridden.

    `auth_state["user"]` controls who the route thinks is calling:
      - dict with `is_admin=True` → admin
      - dict with `is_admin=False` → regular user
      - None → simulate missing / invalid bearer (raises 401)
    """
    from fastapi import HTTPException

    from tcsh_ar_api.auth.dependencies import get_current_user, require_admin
    from tcsh_ar_api.auth.schemas import CurrentUser
    from tcsh_ar_api.db.session import get_db
    from tcsh_ar_api.main import app as fastapi_app

    # Default to admin so the 90% happy path doesn't have to opt in.
    auth_state["user"] = admin_user

    async def _override_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def _override_get_current_user() -> CurrentUser:
        user = auth_state["user"]
        if user is None:
            raise HTTPException(
                status_code=401,
                detail="missing bearer token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return CurrentUser(**user)

    async def _override_require_admin() -> CurrentUser:
        user = auth_state["user"]
        if user is None:
            raise HTTPException(
                status_code=401,
                detail="missing bearer token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        cu = CurrentUser(**user)
        if not cu.is_admin:
            raise HTTPException(status_code=403, detail="admin required")
        return cu

    fastapi_app.dependency_overrides[get_db] = _override_db
    fastapi_app.dependency_overrides[get_current_user] = _override_get_current_user
    fastapi_app.dependency_overrides[require_admin] = _override_require_admin
    try:
        yield fastapi_app
    finally:
        fastapi_app.dependency_overrides.clear()


@pytest_asyncio.fixture(loop_scope="session")
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ── Auth-state helpers for individual tests ──────────────────────────────


@pytest.fixture
def as_admin(auth_state: dict[str, Any], admin_user: dict[str, Any]) -> Callable[[], None]:
    def _set() -> None:
        auth_state["user"] = admin_user

    return _set


@pytest.fixture
def as_regular(
    auth_state: dict[str, Any], regular_user: dict[str, Any]
) -> Callable[[], None]:
    def _set() -> None:
        auth_state["user"] = regular_user

    return _set


@pytest.fixture
def as_anonymous(auth_state: dict[str, Any]) -> Callable[[], None]:
    def _set() -> None:
        auth_state["user"] = None

    return _set


# ── Convenience builders for cross-domain object/anchor/texture creation ──


def _unit_quat() -> dict[str, float]:
    return {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}


def _vec3(x: float = 0.0, y: float = 0.0, z: float = 0.0) -> dict[str, float]:
    return {"x": x, "y": y, "z": z}


def _identity_transform() -> dict[str, Any]:
    return {
        "position": _vec3(),
        "rotation": _unit_quat(),
        "scale": _vec3(1.0, 1.0, 1.0),
    }


@pytest.fixture
def make_anchor_payload() -> Callable[..., dict[str, Any]]:
    def _build(label: str = "Station A", size_mm: int = 200, **overrides: Any) -> dict[str, Any]:
        body: dict[str, Any] = {"label": label, "size_mm": size_mm, "world_pos": None}
        body.update(overrides)
        return body

    return _build


@pytest.fixture
def make_object_payload() -> Callable[..., dict[str, Any]]:
    def _build(label: str = "彩繪神像", **overrides: Any) -> dict[str, Any]:
        body: dict[str, Any] = {"label": label, "description": None}
        body.update(overrides)
        return body

    return _build


@pytest.fixture
def make_placement_payload() -> Callable[..., dict[str, Any]]:
    def _build(
        ar_object_id: UUID | str,
        anchor_id: UUID | str,
        texture_id: UUID | str | None = None,
        **overrides: Any,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "ar_object_id": str(ar_object_id),
            "anchor_id": str(anchor_id),
            "texture_id": str(texture_id) if texture_id is not None else None,
            "transform": _identity_transform(),
            "uv_transform": None,
        }
        body.update(overrides)
        return body

    return _build


@pytest_asyncio.fixture(loop_scope="session")
async def seeded_texture(db_session: AsyncSession) -> Any:
    """Insert a Texture row directly so placement tests can FK-reference it.

    Bypasses the texture router on purpose — that endpoint signs an upload
    URL and doesn't insert into `textures` (Supabase Storage triggers do).
    """
    from tcsh_ar_api.textures.models import Texture

    tex = Texture(
        storage_path=f"{uuid4()}/seed.webp",
        mime="image/webp",
        size_bytes=1024,
        original_filename="seed.webp",
    )
    db_session.add(tex)
    await db_session.flush()
    return tex
