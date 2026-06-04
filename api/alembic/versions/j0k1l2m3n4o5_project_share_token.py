"""add share_token to projects

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-06-02 12:00:00.000000
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = 'j0k1l2m3n4o5'
down_revision: Union[str, None] = 'i9j0k1l2m3n4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('share_token', sa.String(64), nullable=True))
    op.create_index('ix_projects_share_token', 'projects', ['share_token'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_projects_share_token', 'projects')
    op.drop_column('projects', 'share_token')
