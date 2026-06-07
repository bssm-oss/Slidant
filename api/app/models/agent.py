from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class AgentDefinition(SQLModel, table=True):
    __tablename__ = "agent_definitions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID | None = Field(default=None, foreign_key="users.id")  # None = system agent
    project_id: UUID | None = Field(default=None, foreign_key="projects.id", index=True)  # None = library/system
    name: str = Field(max_length=100)
    role: str = Field(max_length=50)  # content | design | layout | custom
    config: dict = Field(default_factory=dict, sa_column=Column(JSONB))
    is_system: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AgentRun(SQLModel, table=True):
    __tablename__ = "agent_runs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    project_id: UUID = Field(foreign_key="projects.id", index=True)
    agent_definition_id: UUID = Field(foreign_key="agent_definitions.id")
    langgraph_thread_id: str | None = Field(default=None, max_length=255)
    status: str = Field(default="idle", max_length=50)  # idle | running | done | error | conflict
    started_at: datetime | None = None
    finished_at: datetime | None = None
    task_description: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    result_summary: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    agent_name: str | None = Field(default=None, max_length=100)
    affected_slide_id: UUID | None = Field(default=None, foreign_key="slides.id")


class LlmLog(SQLModel, table=True):
    __tablename__ = "llm_logs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    agent_run_id: UUID = Field(foreign_key="agent_runs.id", index=True)
    model: str = Field(max_length=100)
    prompt: str
    response: str
    tokens_input: int = 0
    tokens_output: int = 0
    cache_hit: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
