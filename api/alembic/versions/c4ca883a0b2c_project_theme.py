"""project_theme

Revision ID: c4ca883a0b2c
Revises: a2b3c4d5e6f7
Create Date: 2026-06-02 12:11:36.095547

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c4ca883a0b2c'
down_revision: Union[str, None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('theme', postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('projects', 'theme')
