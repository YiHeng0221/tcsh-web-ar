"""Shared pytest fixtures for the FastAPI test suite.

Strategy
--------
After the Supabase → SQLite migration the suite runs entirely against an
in-memory SQLite database (aiosqlite). One shared connection is held open
for the whole session via SQLAlchemy's ``StaticPool`` so the ``:memory:``
database survives between checkouts — a fresh aiosqlite connection would
otherwise get its own empty database. The schema is created once per session
from ``Base.metadata``; each test is isolated by ``DELETE``-ing every mutable
domain table on teardown (SQLite has no ``TRUNCATE ... CASCADE``).

Why real SQLite rather than mocking the DB:

1. The integrity classifiers in ``db/integrity.py`` branch on the SQLite
   driver's error *message* ("UNIQUE constraint failed", "FOREIGN KEY
   constraint failed"); only a real connection surfaces those.
2. The JSON columns (``anchors.world_pos``, ``placements.transform``) are
   part of the wire contract — we want round-tripping through a real engine.

Auth is the local single-admin model (HS256 JWT, no user table). The
``require_admin`` / ``get_current_admin`` dependency is overridden directly
so route tests can flip between "admin", "non-admin token" and "anonymous"
without minting real JWTs. The JWT verify/mint path itself is covered by
``tests/auth/test_jwt_service.py`` and ``tests/auth/test_auth_router.py``.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator, AsyncIterator, Callable
from typing import Any
from uuid import UUID, uuid4  # noqa: F401 — uuid4 kept for test helpers' convenience

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
from sqlalchemy.pool import StaticPool

# Local-auth env must be in place before tcsh_ar_api.config caches Settings —
# importing `main` triggers the lifespan, which reads JWT_SECRET / ADMIN_*.
# These are only read at boot; the auth dependency is fully overridden below.
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET", "test-secret-32-bytes-pad-pad-pad-pad")
os.environ.setdefault("ADMIN_EMAIL", "admin@example.test")
os.environ.setdefault("ADMIN_PASSWORD_HASH", "")
# In-memory SQLite for the test DB; overridden below via a StaticPool engine,
# but the env default keeps `db.session` import-safe if it's ever touched.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def engine() -> AsyncIterator[Any]:
    """One in-memory SQLite engine for the whole run.

    ``StaticPool`` + a single shared connection keep the ``:memory:`` database
    alive across sessions; without it every checkout would see an empty DB.
    """
    # Late import so the env defaults above land in Settings before any model
    # metadata is evaluated.
    from sqlalchemy import event

    from tcsh_ar_api.db import models as _models  # noqa: F401 — register mappers
    from tcsh_ar_api.db.base import Base

    test_engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        future=True,
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )

    # SQLite enforces foreign keys only when asked — required for the
    # CASCADE / SET NULL clauses the integrity tests exercise.
    @event.listens_for(test_engine.sync_engine, "connect")
    def _set_sqlite_pragma(dbapi_connection: Any, _record: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield test_engine
    finally:
        await test_engine.dispose()


@pytest_asyncio.fixture
async def db_session(engine: Any) -> AsyncIterator[AsyncSession]:
    """One AsyncSession per test, isolated by deleting mutable tables on teardown.

    SQLite has no ``TRUNCATE ... CASCADE``; we ``DELETE`` in FK-safe order
    (placements → ar_objects → anchors → textures) instead. Fast enough that
    the whole suite still runs in a couple of seconds.
    """
    SessionLocal = async_sessionmaker(  # noqa: N806
        bind=engine,
        expire_on_commit=False,
    )
    async with SessionLocal() as session:
        try:
            yield session
        finally:
            await session.rollback()
            for table in ("placements", "ar_objects", "anchors", "textures"):
                await session.execute(_text(f"DELETE FROM {table}"))
            await session.commit()


# ── Auth identity fixtures ────────────────────────────────────────────────
# `auth_state["user"]` is the identity the route sees once `require_admin` /
# `get_current_admin` are overridden. Default is the admin so happy-path
# tests don't have to opt in; tests that exercise the auth gate flip it.
#
# Single-admin model: a *valid* token always represents the admin, so there
# is no "authenticated non-admin" identity. `as_regular` therefore stands in
# for "a caller presenting a token that does not resolve to the admin" — in
# the local-JWT implementation that surfaces as a rejected (invalid) token.


@pytest.fixture
def admin_user() -> dict[str, Any]:
    from tcsh_ar_api.auth.schemas import LocalUser

    return LocalUser(email="admin@example.test", is_admin=True).model_dump()


@pytest.fixture
def auth_state() -> dict[str, Any]:
    """Mutable holder so individual tests can flip the active caller mid-test.

    Values:
      - dict (a LocalUser dump) → resolves to that user
      - "invalid" → simulate a token that fails verification (→ 401)
      - None → simulate a missing bearer token (→ 401)
    """
    return {"user": None}


@pytest_asyncio.fixture
async def app(
    db_session: AsyncSession,
    auth_state: dict[str, Any],
    admin_user: dict[str, Any],
) -> AsyncIterator[FastAPI]:
    """A FastAPI app instance with DB and auth dependencies overridden.

    `auth_state["user"]` controls who the route thinks is calling:
      - dict with `is_admin=True` → admin (happy path)
      - "invalid" → token present but rejected → 401
      - None → missing bearer token → 401
    """
    from fastapi import HTTPException

    from tcsh_ar_api.auth.dependencies import get_current_admin, require_admin
    from tcsh_ar_api.auth.schemas import LocalUser
    from tcsh_ar_api.db.session import get_db
    from tcsh_ar_api.main import app as fastapi_app

    # Default to admin so the 90% happy path doesn't have to opt in.
    auth_state["user"] = admin_user

    bearer_challenge = {"WWW-Authenticate": "Bearer"}

    async def _override_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def _override_require_admin() -> LocalUser:
        user = auth_state["user"]
        if user is None or user == "invalid":
            raise HTTPException(
                status_code=401,
                detail="missing bearer token",
                headers=bearer_challenge,
            )
        return LocalUser(**user)

    fastapi_app.dependency_overrides[get_db] = _override_db
    fastapi_app.dependency_overrides[require_admin] = _override_require_admin
    fastapi_app.dependency_overrides[get_current_admin] = _override_require_admin
    try:
        yield fastapi_app
    finally:
        fastapi_app.dependency_overrides.clear()


@pytest_asyncio.fixture
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
def as_regular(auth_state: dict[str, Any]) -> Callable[[], None]:
    """Simulate a caller whose token does not resolve to the admin.

    The single-admin model has no authenticated non-admin identity — a token
    that isn't the admin's simply fails verification — so this maps to a
    rejected token (401), the closest equivalent of the old "non-admin → 403"
    gate from the Supabase two-tier role model.
    """

    def _set() -> None:
        auth_state["user"] = "invalid"

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


@pytest_asyncio.fixture
async def seeded_texture(db_session: AsyncSession) -> Any:
    """Insert a Texture row directly so placement tests can FK-reference it.

    Uses the local-filesystem texture model fields (label / filename /
    mime_type / size_bytes); no bytes are written to disk because placement
    tests only need the row's UUID for the foreign key.
    """
    from tcsh_ar_api.textures.models import Texture

    tex = Texture(
        label="seed",
        filename="seed.webp",
        mime_type="image/webp",
        size_bytes=1024,
    )
    db_session.add(tex)
    await db_session.flush()
    return tex
