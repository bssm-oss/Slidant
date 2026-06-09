"""add cascade to agent runs and llm logs

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa

revision = 't0u1v2w3x4y5'
down_revision = 's9t0u1v2w3x4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # agent_runs -> agent_definitions
    op.drop_constraint('agent_runs_agent_definition_id_fkey', 'agent_runs', type_='foreignkey')
    op.create_foreign_key(
        'fk_agent_runs_agent_definition_id',
        'agent_runs', 'agent_definitions',
        ['agent_definition_id'], ['id'],
        ondelete='CASCADE'
    )

    # llm_logs -> agent_runs
    op.drop_constraint('llm_logs_agent_run_id_fkey', 'llm_logs', type_='foreignkey')
    op.create_foreign_key(
        'fk_llm_logs_agent_run_id',
        'llm_logs', 'agent_runs',
        ['agent_run_id'], ['id'],
        ondelete='CASCADE'
    )


def downgrade() -> None:
    op.drop_constraint('fk_llm_logs_agent_run_id', 'llm_logs', type_='foreignkey')
    op.create_foreign_key(
        'llm_logs_agent_run_id_fkey',
        'llm_logs', 'agent_runs',
        ['agent_run_id'], ['id']
    )

    op.drop_constraint('fk_agent_runs_agent_definition_id', 'agent_runs', type_='foreignkey')
    op.create_foreign_key(
        'agent_runs_agent_definition_id_fkey',
        'agent_runs', 'agent_definitions',
        ['agent_definition_id'], ['id']
    )
