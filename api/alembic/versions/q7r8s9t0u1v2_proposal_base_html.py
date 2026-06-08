"""agent_proposals base_html_content

Revision ID: q7r8s9t0u1v2
Revises: p6q7r8s9t0u1
Create Date: 2026-06-08

"""
from alembic import op
import sqlalchemy as sa

revision = 'q7r8s9t0u1v2'
down_revision = 'p6q7r8s9t0u1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('agent_proposals', sa.Column('base_html_content', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('agent_proposals', 'base_html_content')
