"""agent_proposals.html_content 컬럼 추가 (HTML 모드 제안)

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
Create Date: 2026-06-06 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'm3n4o5p6q7r8'
down_revision: Union[str, None] = 'l2m3n4o5p6q7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('agent_proposals', sa.Column('html_content', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('agent_proposals', 'html_content')
