"""Alembic environment — async version for SQLAlchemy 2.0 + asyncpg.

Imports every domain module's `models.py` so `--autogenerate` sees the full
metadata. If you add a new domain module, add its import here too.
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from tcsh_ar_api.config import get_settings
from tcsh_ar_api.db.base import Base

# Side-effect imports so `target_metadata` sees every table. Do NOT remove.
from tcsh_ar_api.anchors import models as _anchors_models  # noqa: F401
from tcsh_ar_api.objects import models as _objects_models  # noqa: F401
from tcsh_ar_api.placements import models as _placements_models  # noqa: F401
from tcsh_ar_api.textures import models as _textures_models  # noqa: F401

config = context.config

# Override sqlalchemy.url from our Settings (reads .env)
_settings = get_settings()
config.set_main_option("sqlalchemy.url", _settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
