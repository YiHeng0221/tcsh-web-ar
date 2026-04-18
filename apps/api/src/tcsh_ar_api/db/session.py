from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from tcsh_ar_api.config import get_settings

_settings = get_settings()

# Supabase's Supavisor transaction pooler (port 6543) multiplexes many clients
# over the same backend connection, so prepared statements cannot be cached on
# the session. Disable both caches: `statement_cache_size` covers asyncpg's
# own cache; `prepared_statement_cache_size` covers the SQLAlchemy-asyncpg
# dialect's layer on top.
engine = create_async_engine(
    _settings.database_url,
    pool_pre_ping=True,
    echo=False,
    connect_args={
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
    },
)

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
