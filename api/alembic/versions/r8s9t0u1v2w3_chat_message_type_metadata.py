"""chat_message_type_metadata

Revision ID: r8s9t0u1v2w3
Revises: q7r8s9t0u1v2
Create Date: 2026-06-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'r8s9t0u1v2w3'
down_revision = 'q7r8s9t0u1v2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('chat_messages', sa.Column('message_type', sa.String(length=50), nullable=True))
    op.add_column('chat_messages', sa.Column('extra_data', JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column('chat_messages', 'extra_data')
    op.drop_column('chat_messages', 'message_type')
