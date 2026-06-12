"""Backend-portable classification of SQLAlchemy IntegrityError causes.

Postgres surfaces failure modes via 5-char SQLSTATE codes on the asyncpg
exception (`exc.orig.sqlstate`). SQLite's aiosqlite driver doesn't carry
SQLSTATE — it raises ``sqlite3.IntegrityError`` whose ``str()`` is a phrase
like ``UNIQUE constraint failed: anchors.label`` or ``FOREIGN KEY constraint
failed``. The service layer wants to know "unique vs. FK vs. other" without
caring which dialect produced the failure.

Service code calls ``classify_integrity_error(exc)`` and matches on the
returned :class:`IntegrityCause`. New backends only need their fingerprints
added here; the service layer stays untouched.
"""

from __future__ import annotations

from enum import Enum

from sqlalchemy.exc import IntegrityError


class IntegrityCause(str, Enum):
    UNIQUE_VIOLATION = "unique_violation"
    FOREIGN_KEY_VIOLATION = "foreign_key_violation"
    OTHER = "other"


# Postgres SQLSTATEs — see https://www.postgresql.org/docs/current/errcodes-appendix.html
_PG_UNIQUE_VIOLATION = "23505"
_PG_FOREIGN_KEY_VIOLATION = "23503"


def classify_integrity_error(exc: IntegrityError) -> IntegrityCause:
    """Map a SQLAlchemy IntegrityError onto a dialect-agnostic cause."""
    orig = getattr(exc, "orig", None)

    sqlstate = getattr(orig, "sqlstate", None)
    if sqlstate == _PG_UNIQUE_VIOLATION:
        return IntegrityCause.UNIQUE_VIOLATION
    if sqlstate == _PG_FOREIGN_KEY_VIOLATION:
        return IntegrityCause.FOREIGN_KEY_VIOLATION

    # SQLite (sqlite3 / aiosqlite) carries the failure mode in the message.
    # Match on the canonical phrase rather than the column-qualified suffix
    # so the check stays stable across SQLite versions.
    message = str(orig) if orig is not None else str(exc)
    if "UNIQUE constraint failed" in message:
        return IntegrityCause.UNIQUE_VIOLATION
    if "FOREIGN KEY constraint failed" in message:
        return IntegrityCause.FOREIGN_KEY_VIOLATION

    return IntegrityCause.OTHER
