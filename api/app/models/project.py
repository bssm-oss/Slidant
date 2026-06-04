from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, LargeBinary
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class Project(SQLModel, table=True):
    __tablename__ = "projects"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    owner_id: UUID = Field(foreign_key="users.id", index=True)
    title: str = Field(max_length=500)
    theme: dict | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
    share_token: str | None = Field(default=None, max_length=64)
    yjs_state: bytes | None = Field(default=None, sa_column=Column(LargeBinary, nullable=True))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
