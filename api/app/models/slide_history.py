from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class SlideHistory(SQLModel, table=True):
    __tablename__ = "slide_history"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    slide_id: UUID = Field(foreign_key="slides.id", index=True)
    version: int
    content: list = Field(default_factory=list, sa_column=Column(JSONB, nullable=False, server_default="[]"))
    reason: str = Field(default="", max_length=500)
    created_at: datetime = Field(default_factory=datetime.utcnow)
