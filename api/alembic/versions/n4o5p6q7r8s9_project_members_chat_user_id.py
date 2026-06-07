"""project_members 테이블 추가 + chat_sessions/chat_messages user_id 컬럼 추가

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
Create Date: 2026-06-07 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'n4o5p6q7r8s9'
down_revision: Union[str, None] = 'm3n4o5p6q7r8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'project_members',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False, server_default='editor'),
        sa.Column('joined_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'user_id', name='uq_project_member'),
    )
    op.create_index('ix_project_members_project_id', 'project_members', ['project_id'])
    op.create_index('ix_project_members_user_id', 'project_members', ['user_id'])

    op.add_column('chat_sessions', sa.Column('user_id', sa.UUID(), nullable=True))
    op.create_foreign_key(None, 'chat_sessions', 'users', ['user_id'], ['id'])
    op.create_index('ix_chat_sessions_user_id', 'chat_sessions', ['user_id'])

    op.add_column('chat_messages', sa.Column('user_id', sa.UUID(), nullable=True))
    op.create_foreign_key(None, 'chat_messages', 'users', ['user_id'], ['id'])
    op.create_index('ix_chat_messages_user_id', 'chat_messages', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_chat_messages_user_id', 'chat_messages')
    op.drop_column('chat_messages', 'user_id')

    op.drop_index('ix_chat_sessions_user_id', 'chat_sessions')
    op.drop_column('chat_sessions', 'user_id')

    op.drop_index('ix_project_members_user_id', 'project_members')
    op.drop_index('ix_project_members_project_id', 'project_members')
    op.drop_table('project_members')
