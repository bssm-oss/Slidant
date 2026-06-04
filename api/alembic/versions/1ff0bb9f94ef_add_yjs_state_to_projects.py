"""add_yjs_state_to_projects

Revision ID: 1ff0bb9f94ef
Revises: j0k1l2m3n4o5
Create Date: 2026-06-04 14:05:55.238538

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '1ff0bb9f94ef'
down_revision: Union[str, None] = 'j0k1l2m3n4o5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("yjs_state", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "yjs_state")
