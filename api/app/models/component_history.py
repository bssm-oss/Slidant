from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class ComponentHistory(SQLModel, table=True):
    __tablename__ = "component_history"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    slide_id: UUID = Field(foreign_key="slides.id", index=True)
    component_id: str = Field(max_length=100, index=True)  # JSONB 내 컴포넌트 UUID
    op: str = Field(max_length=10)   # 'add' | 'replace' | 'remove'
    path: str = Field(max_length=500, default="")  # JSON Patch path e.g. '/properties/content'
    old_value: dict | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
    new_value: dict | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
    agent_name: str | None = Field(default=None, max_length=100)
    reason: str = Field(default="", max_length=500)
    created_at: datetime = Field(default_factory=datetime.utcnow)
