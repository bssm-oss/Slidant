"""agent_run history fields

Revision ID: p6q7r8s9t0u1
Revises: o5p6q7r8s9t0
Create Date: 2026-06-08

"""
from alembic import op
import sqlalchemy as sa

revision = 'p6q7r8s9t0u1'
down_revision = 'o5p6q7r8s9t0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('agent_runs', sa.Column('task_description', sa.Text(), nullable=True))
    op.add_column('agent_runs', sa.Column('result_summary', sa.Text(), nullable=True))
    op.add_column('agent_runs', sa.Column('agent_name', sa.String(100), nullable=True))
    op.add_column('agent_runs',
        sa.Column('affected_slide_id', sa.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_agent_runs_affected_slide_id',
        'agent_runs', 'slides',
        ['affected_slide_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_agent_runs_affected_slide_id', 'agent_runs', type_='foreignkey')
    op.drop_column('agent_runs', 'affected_slide_id')
    op.drop_column('agent_runs', 'agent_name')
    op.drop_column('agent_runs', 'result_summary')
    op.drop_column('agent_runs', 'task_description')
