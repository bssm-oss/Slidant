from datetime import datetime
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class Slide(SQLModel, table=True):
    __tablename__ = "slides"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    project_id: UUID = Field(foreign_key="projects.id", index=True)
    order: int = 0
    title: str | None = Field(default=None, max_length=500)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
