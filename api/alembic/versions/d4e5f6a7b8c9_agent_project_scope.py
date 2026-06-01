"""agent_definitions: add project_id for project-scoped agents

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-01 16:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("agent_definitions", sa.Column("project_id", sa.Uuid(), nullable=True))
    op.create_index("ix_agent_definitions_project_id", "agent_definitions", ["project_id"])
    op.create_foreign_key(
        "fk_agent_definitions_project_id",
        "agent_definitions", "projects",
        ["project_id"], ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_agent_definitions_project_id", "agent_definitions", type_="foreignkey")
    op.drop_index("ix_agent_definitions_project_id", table_name="agent_definitions")
    op.drop_column("agent_definitions", "project_id")
