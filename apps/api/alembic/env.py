"""Alembic environment — async version for SQLAlchemy 2.0 + aiosqlite.

Imports every domain module's `models.py` so `--autogenerate` sees the full
metadata. If you add a new domain module, add its import here too.
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from tcsh_ar_api.config import get_settings
from tcsh_ar_api.db.base import Base

# Side-effect imports so `target_metadata` sees every table. Do NOT remove.
from tcsh_ar_api.anchors import models as _anchors_models  # noqa: F401
from tcsh_ar_api.objects import models as _objects_models  # noqa: F401
from tcsh_ar_api.placements import models as _placements_models  # noqa: F401
from tcsh_ar_api.textures import models as _textures_models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Migrations resolve the URL from Settings rather than alembic.ini's
# configparser, which would try to %-interpolate any percent signs in a
# Postgres password if/when the deployment swaps backends.
_settings = get_settings()
_DATABASE_URL = _settings.database_url_direct
_IS_SQLITE = _DATABASE_URL.startswith("sqlite")

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=_DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # SQLite cannot ALTER TABLE in-place beyond a few simple cases, so
        # batch mode rewrites the table whenever a column changes. Harmless
        # on Postgres, so we leave it on unconditionally for SQLite and skip
        # otherwise.
        render_as_batch=_IS_SQLITE,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=_IS_SQLITE,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = create_async_engine(_DATABASE_URL, poolclass=pool.NullPool)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
