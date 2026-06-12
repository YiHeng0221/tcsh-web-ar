"""initial schema: anchors, ar_objects, textures, placements

Revision ID: 0001
Revises:
Create Date: 2026-04-18

Creates the four core tables behind Mode A / B / C along with their
foreign-key relationships.

Manually authored rather than `--autogenerate`d; equivalent output. Once
an actual dev DB is available, `alembic upgrade head` should produce the
schema described by the SQLAlchemy models under src/tcsh_ar_api/*/models.py.

Types are dialect-portable (GUID + JSON) so the same migration runs on
SQLite (default for dev) and on Postgres (if deployment ever swaps back).

Texture storage is local-filesystem (see settings.texture_storage_dir);
the row carries enough metadata to serve the file via
``GET /textures/{id}/file`` without storing an absolute path.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from tcsh_ar_api.db.base import GUID

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "anchors",
        sa.Column(
            "id",
            GUID(),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("label", sa.String(length=64), nullable=False, unique=True),
        sa.Column("size_mm", sa.Integer(), nullable=False),
        sa.Column("world_pos", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "ar_objects",
        sa.Column(
            "id",
            GUID(),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "textures",
        sa.Column(
            "id",
            GUID(),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("label", sa.String(length=256), nullable=False),
        sa.Column("filename", sa.String(length=256), nullable=False),
        sa.Column("mime_type", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "placements",
        sa.Column(
            "id",
            GUID(),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "ar_object_id",
            GUID(),
            sa.ForeignKey("ar_objects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "anchor_id",
            GUID(),
            sa.ForeignKey("anchors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "texture_id",
            GUID(),
            sa.ForeignKey("textures.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("transform", sa.JSON(), nullable=False),
        sa.Column("uv_transform", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "ar_object_id", "anchor_id", name="uq_placement_object_anchor"
        ),
    )


def downgrade() -> None:
    op.drop_table("placements")
    op.drop_table("textures")
    op.drop_table("ar_objects")
    op.drop_table("anchors")
