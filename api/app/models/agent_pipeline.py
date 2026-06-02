from datetime import datetime
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class AgentPipeline(SQLModel, table=True):
    __tablename__ = "agent_pipelines"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    project_id: UUID = Field(foreign_key="projects.id", index=True)
    name: str = Field(max_length=200)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PipelineStep(SQLModel, table=True):
    __tablename__ = "pipeline_steps"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    pipeline_id: UUID = Field(foreign_key="agent_pipelines.id", index=True)
    step_order: int
    agent_definition_id: UUID = Field(foreign_key="agent_definitions.id")
    command_template: str = Field(max_length=1000)
    created_at: datetime = Field(default_factory=datetime.utcnow)
