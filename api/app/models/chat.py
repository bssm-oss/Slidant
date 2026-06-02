from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class ChatMessage(SQLModel, table=True):
    __tablename__ = "chat_messages"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    project_id: UUID = Field(foreign_key="projects.id", index=True)
    slide_id: UUID | None = Field(default=None, foreign_key="slides.id")
    role: str = Field(max_length=10)  # user | agent
    content: str
    agent_run_id: UUID | None = Field(default=None, foreign_key="agent_runs.id")
    agent_definition_id: UUID | None = Field(default=None, foreign_key="agent_definitions.id", index=True)
    agent_name: str | None = Field(default=None, max_length=100)
    affected_component_ids: list = Field(default_factory=list, sa_column=Column(JSONB, nullable=False, server_default="[]"))
    session_id: UUID | None = Field(default=None, foreign_key="chat_sessions.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
