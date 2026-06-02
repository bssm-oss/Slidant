from datetime import datetime
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class ChatSession(SQLModel, table=True):
    __tablename__ = "chat_sessions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    project_id: UUID = Field(foreign_key="projects.id", index=True)
    name: str = Field(max_length=200, default="새 세션")
    created_at: datetime = Field(default_factory=datetime.utcnow)
