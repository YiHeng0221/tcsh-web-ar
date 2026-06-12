from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy import event
from sqlalchemy.engine.interfaces import DBAPIConnection
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import ConnectionPoolEntry

from tcsh_ar_api.config import get_settings

_settings = get_settings()

# SQLite (via aiosqlite) is the default backend for local dev. The
# `check_same_thread=False` arg lets aiosqlite hand the connection between
# threads — required because SQLAlchemy's async layer dispatches calls onto a
# worker thread, not the event-loop thread that opened the connection.
_engine_kwargs: dict[str, Any] = {"echo": False}
if _settings.database_url.startswith("sqlite"):
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
else:  # pragma: no cover — non-SQLite dialects aren't exercised in tests
    # Pre-ping protects long-lived workers from stale TCP connections;
    # SQLite's in-process file handle never goes stale, so we skip it there.
    _engine_kwargs["pool_pre_ping"] = True

engine = create_async_engine(_settings.database_url, **_engine_kwargs)


# SQLite ships with foreign-key enforcement *off* by default — every new
# connection has to opt in via `PRAGMA foreign_keys=ON`, otherwise our
# `ondelete="CASCADE" / SET NULL` clauses silently no-op. Hook the sync
# DBAPI-connect event so the pragma fires once per connection.
if _settings.database_url.startswith("sqlite"):

    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragma(
        dbapi_connection: DBAPIConnection,
        _connection_record: ConnectionPoolEntry,
    ) -> None:
        cursor = dbapi_connection.cursor()
        # Enable WAL so readers don't block writers — prevents "database is
        # locked" under concurrent uvicorn workers or simultaneous GET + upload.
        # NORMAL synchronous mode is safe with WAL (crash-safe, fsync at
        # checkpoints) and significantly faster than FULL.
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        # FK enforcement is off by default in SQLite — every new connection
        # must opt in for CASCADE / SET NULL to take effect.
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields a per-request AsyncSession.

    Session lifecycle: opened on entry, closed on exit. The service layer is
    responsible for commit/rollback; this helper only wires the session.
    """
    async with SessionLocal() as session:
        yield session
