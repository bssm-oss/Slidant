"""component_history slide_id FK → ondelete CASCADE

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-06-06 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op

revision: str = 'k1l2m3n4o5p6'
down_revision: Union[str, None] = '1ff0bb9f94ef'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL FK 이름: 기본 규칙 {table}_{col}_fkey
    op.drop_constraint('component_history_slide_id_fkey', 'component_history', type_='foreignkey')
    op.create_foreign_key(
        'component_history_slide_id_fkey',
        'component_history', 'slides',
        ['slide_id'], ['id'],
        ondelete='CASCADE',
    )


def downgrade() -> None:
    op.drop_constraint('component_history_slide_id_fkey', 'component_history', type_='foreignkey')
    op.create_foreign_key(
        'component_history_slide_id_fkey',
        'component_history', 'slides',
        ['slide_id'], ['id'],
    )
