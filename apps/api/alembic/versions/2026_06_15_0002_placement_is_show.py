"""placement is_show flag

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-15

Adds `placements.is_show` — Mode C's visibility toggle so an artist can
hide a placement without deleting it. Defaults to true (visible) so every
existing row stays shown. Mode A's render layer filters on this column.

Dialect-portable: a plain Boolean with a server_default of "1" works on
both SQLite (dev) and Postgres (if deployment swaps back).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "placements",
        sa.Column(
            "is_show",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )


def downgrade() -> None:
    op.drop_column("placements", "is_show")
