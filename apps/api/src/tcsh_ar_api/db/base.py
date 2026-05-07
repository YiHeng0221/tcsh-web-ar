from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import CHAR, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.engine import Dialect
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.types import TypeDecorator, TypeEngine


class Base(DeclarativeBase):
    """Declarative base shared by every SQLAlchemy model in this project.

    Keeping a single Base means Alembic's autogenerate sees the full metadata
    after the domain modules import their models.
    """


class GUID(TypeDecorator[uuid.UUID]):
    """Platform-independent UUID column.

    Stores as native ``UUID`` on PostgreSQL and as ``CHAR(36)`` (lower-case
    hex string) on every other backend (SQLite included). Returns
    ``uuid.UUID`` instances on the Python side either way, so models can
    keep their ``Mapped[uuid.UUID]`` annotations and the rest of the
    codebase doesn't have to care which dialect we're on.

    See https://docs.sqlalchemy.org/en/20/core/custom_types.html#backend-agnostic-guid-type
    """

    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        return dialect.type_descriptor(String(36))

    def process_bind_param(
        self, value: uuid.UUID | str | None, dialect: Dialect
    ) -> str | uuid.UUID | None:
        if value is None:
            return None
        if dialect.name == "postgresql":
            return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
        if isinstance(value, uuid.UUID):
            return str(value)
        return str(uuid.UUID(str(value)))

    def process_result_value(
        self, value: str | uuid.UUID | None, dialect: Dialect
    ) -> uuid.UUID | None:
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(str(value))
