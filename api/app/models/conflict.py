from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class Conflict(SQLModel, table=True):
    __tablename__ = "conflicts"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    project_id: UUID = Field(foreign_key="projects.id", index=True)
    component_id: UUID = Field(foreign_key="components.id", index=True)
    agent_run_a_id: UUID = Field(foreign_key="agent_runs.id")
    agent_run_b_id: UUID = Field(foreign_key="agent_runs.id")
    status: str = Field(default="pending", max_length=50)  # pending | resolved
    patch_a: list = Field(default_factory=list, sa_column=Column(JSONB))
    patch_b: list = Field(default_factory=list, sa_column=Column(JSONB))
    resolved_by_user_id: UUID | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    resolved_at: datetime | None = None
