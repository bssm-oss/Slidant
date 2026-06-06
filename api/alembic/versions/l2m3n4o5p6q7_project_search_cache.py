"""project search_summary/search_queries 캐시 컬럼 추가

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-06-06 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = 'l2m3n4o5p6q7'
down_revision: Union[str, None] = 'k1l2m3n4o5p6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('search_summary', sa.Text(), nullable=True))
    op.add_column('projects', sa.Column('search_queries', JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('projects', 'search_queries')
    op.drop_column('projects', 'search_summary')
