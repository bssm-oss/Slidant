from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class Component(SQLModel, table=True):
    __tablename__ = "components"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    slide_id: UUID = Field(foreign_key="slides.id", index=True)
    parent_id: UUID | None = Field(default=None, foreign_key="components.id")
    type: str = Field(max_length=50)  # text | image | chart | layout | shape
    properties: dict = Field(default_factory=dict, sa_column=Column(JSONB))
    order: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
