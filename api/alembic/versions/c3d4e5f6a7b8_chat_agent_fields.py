"""chat_messages: add agent_definition_id and agent_name

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-01 15:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("agent_definition_id", sa.Uuid(), nullable=True))
    op.add_column("chat_messages", sa.Column("agent_name", sa.String(length=100), nullable=True))
    op.create_index("ix_chat_messages_agent_def_id", "chat_messages", ["agent_definition_id"])
    op.create_foreign_key(
        "fk_chat_messages_agent_definition_id",
        "chat_messages", "agent_definitions",
        ["agent_definition_id"], ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_chat_messages_agent_definition_id", "chat_messages", type_="foreignkey")
    op.drop_index("ix_chat_messages_agent_def_id", table_name="chat_messages")
    op.drop_column("chat_messages", "agent_name")
    op.drop_column("chat_messages", "agent_definition_id")
