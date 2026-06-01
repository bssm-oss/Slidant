"""slides_content_jsonb: move components table into slides.content JSONB

Revision ID: a1b2c3d4e5f6
Revises: 28584ef2b733
Create Date: 2026-06-01 13:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "28584ef2b733"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "slides",
        sa.Column(
            "content",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
    )

    # Migrate existing component rows into slides.content
    op.execute("""
        UPDATE slides s
        SET content = COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id',         c.id::text,
                        'type',       c.type,
                        'parent_id',  c.parent_id::text,
                        'order',      c.order,
                        'properties', c.properties,
                        'created_at', to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                        'updated_at', to_char(c.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                    )
                    ORDER BY c.order
                )
                FROM components c
                WHERE c.slide_id = s.id
            ),
            '[]'::jsonb
        )
    """)

    op.execute("DROP TABLE components CASCADE")


def downgrade() -> None:
    op.create_table(
        "components",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slide_id", sa.Uuid(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("properties", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["slide_id"], ["slides.id"]),
        sa.ForeignKeyConstraint(["parent_id"], ["components.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_components_slide_id", "components", ["slide_id"])

    # Restore component rows from slides.content
    op.execute("""
        INSERT INTO components (id, slide_id, parent_id, type, properties, "order", created_at, updated_at)
        SELECT
            (comp->>'id')::uuid,
            s.id,
            NULLIF(comp->>'parent_id', 'null')::uuid,
            comp->>'type',
            (comp->'properties')::jsonb,
            (comp->>'order')::int,
            (comp->>'created_at')::timestamp,
            (comp->>'updated_at')::timestamp
        FROM slides s,
             jsonb_array_elements(s.content) AS comp
        WHERE s.content != '[]'::jsonb
    """)

    op.drop_column("slides", "content")
