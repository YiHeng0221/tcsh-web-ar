"""initial schema: anchors, ar_objects, textures, placements

Revision ID: 0001
Revises:
Create Date: 2026-04-18

Creates the four core tables behind Mode A / B / C along with their
foreign-key relationships.

Manually authored rather than `--autogenerate`d; equivalent output. Once
an actual dev DB is available, `alembic upgrade head` should produce the
schema described by the SQLAlchemy models under src/tcsh_ar_api/*/models.py.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "anchors",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("label", sa.String(length=64), nullable=False, unique=True),
        sa.Column("size_mm", sa.Integer(), nullable=False),
        sa.Column("world_pos", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
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
            postgresql.UUID(as_uuid=True),
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
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("storage_path", sa.String(length=512), nullable=False, unique=True),
        sa.Column("mime", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("original_filename", sa.String(length=256), nullable=True),
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
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "ar_object_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ar_objects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "anchor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("anchors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "texture_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("textures.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("transform", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("uv_transform", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
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
