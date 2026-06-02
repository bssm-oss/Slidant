"""chat_sessions

Revision ID: a2b3c4d5e6f7
Revises: f6a7b8c9d0e1
Create Date: 2026-06-02 12:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'chat_sessions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('project_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False, server_default='새 세션'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_chat_sessions_project_id', 'chat_sessions', ['project_id'])

    op.add_column(
        'chat_messages',
        sa.Column('session_id', sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        'fk_chat_messages_session_id',
        'chat_messages', 'chat_sessions',
        ['session_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index('ix_chat_messages_session_id', 'chat_messages', ['session_id'])


def downgrade() -> None:
    op.drop_index('ix_chat_messages_session_id', table_name='chat_messages')
    op.drop_constraint('fk_chat_messages_session_id', 'chat_messages', type_='foreignkey')
    op.drop_column('chat_messages', 'session_id')

    op.drop_index('ix_chat_sessions_project_id', table_name='chat_sessions')
    op.drop_table('chat_sessions')
