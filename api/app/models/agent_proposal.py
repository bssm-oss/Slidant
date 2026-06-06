from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class AgentProposal(SQLModel, table=True):
    __tablename__ = "agent_proposals"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    slide_id: UUID = Field(foreign_key="slides.id", index=True)
    agent_run_id: UUID = Field(foreign_key="agent_runs.id")
    agent_name: str = Field(max_length=100)
    command: str
    patches: list = Field(default_factory=list, sa_column=Column(JSONB, nullable=False, server_default="[]"))
    summary: str = Field(default="")
    html_content: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    status: str = Field(default="pending", max_length=20)  # pending|approved|rejected
    created_at: datetime = Field(default_factory=datetime.utcnow)
