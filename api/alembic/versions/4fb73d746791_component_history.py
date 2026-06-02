"""component_history

Revision ID: 4fb73d746791
Revises: d5e6f7a8b9c0
Create Date: 2026-06-02 13:30:51.355482

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '4fb73d746791'
down_revision: Union[str, None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'component_history',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('slide_id', sa.UUID(), nullable=False),
        sa.Column('component_id', sa.String(length=100), nullable=False),
        sa.Column('op', sa.String(length=10), nullable=False),
        sa.Column('path', sa.String(length=500), nullable=False, server_default=''),
        sa.Column('old_value', postgresql.JSONB(), nullable=True),
        sa.Column('new_value', postgresql.JSONB(), nullable=True),
        sa.Column('agent_name', sa.String(length=100), nullable=True),
        sa.Column('reason', sa.String(length=500), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['slide_id'], ['slides.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_component_history_slide_id', 'component_history', ['slide_id'])
    op.create_index('ix_component_history_component_id', 'component_history', ['component_id'])


def downgrade() -> None:
    op.drop_index('ix_component_history_component_id', 'component_history')
    op.drop_index('ix_component_history_slide_id', 'component_history')
    op.drop_table('component_history')
