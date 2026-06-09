"""agent_run user_id

Revision ID: s9t0u1v2w3x4
Revises: r8s9t0u1v2w3
Create Date: 2026-06-09
"""
from alembic import op
import sqlalchemy as sa

revision = 's9t0u1v2w3x4'
down_revision = 'r8s9t0u1v2w3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('agent_runs', sa.Column('user_id', sa.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_agent_runs_user_id',
        'agent_runs', 'users',
        ['user_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_agent_runs_user_id', 'agent_runs', type_='foreignkey')
    op.drop_column('agent_runs', 'user_id')
