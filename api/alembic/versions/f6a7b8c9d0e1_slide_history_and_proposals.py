"""add slide_history and agent_proposals tables

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-02 09:01:00.000000
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.create_table('slide_history',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('slide_id', sa.Uuid(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('content', sa.dialects.postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('reason', sa.String(length=500), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['slide_id'], ['slides.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('slide_id', 'version', name='uq_slide_history_slide_version'),
    )
    op.create_index('ix_slide_history_slide_id', 'slide_history', ['slide_id'])

    op.create_table('agent_proposals',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('slide_id', sa.Uuid(), nullable=False),
        sa.Column('agent_run_id', sa.Uuid(), nullable=False),
        sa.Column('agent_name', sa.String(length=100), nullable=False),
        sa.Column('command', sa.Text(), nullable=False),
        sa.Column('patches', sa.dialects.postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('summary', sa.Text(), nullable=False, server_default=''),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['slide_id'], ['slides.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['agent_run_id'], ['agent_runs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_agent_proposals_slide_id', 'agent_proposals', ['slide_id'])
    op.create_index('ix_agent_proposals_status', 'agent_proposals', ['status'])

def downgrade() -> None:
    op.drop_table('agent_proposals')
    op.drop_table('slide_history')
