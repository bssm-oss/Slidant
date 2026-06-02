"""agent_pipeline

Revision ID: d5e6f7a8b9c0
Revises: c4ca883a0b2c
Create Date: 2026-06-02 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d5e6f7a8b9c0"
down_revision: Union[str, None] = "c4ca883a0b2c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_pipelines",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_pipelines_project_id", "agent_pipelines", ["project_id"])
    op.create_table(
        "pipeline_steps",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("pipeline_id", sa.UUID(), nullable=False),
        sa.Column("step_order", sa.Integer(), nullable=False),
        sa.Column("agent_definition_id", sa.UUID(), nullable=False),
        sa.Column("command_template", sa.String(length=1000), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["pipeline_id"], ["agent_pipelines.id"]),
        sa.ForeignKeyConstraint(["agent_definition_id"], ["agent_definitions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pipeline_steps_pipeline_id", "pipeline_steps", ["pipeline_id"])


def downgrade() -> None:
    op.drop_index("ix_pipeline_steps_pipeline_id", table_name="pipeline_steps")
    op.drop_table("pipeline_steps")
    op.drop_index("ix_agent_pipelines_project_id", table_name="agent_pipelines")
    op.drop_table("agent_pipelines")
