from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class AgentRunRequest(BaseModel):
    project_id: UUID
    slide_id: UUID
    command: str
    agent_role: str = "content"  # content | design | layout | custom


class AgentRunResponse(BaseModel):
    id: UUID
    project_id: UUID
    status: str
    started_at: datetime | None
    finished_at: datetime | None

    model_config = {"from_attributes": True}


class AgentLogResponse(BaseModel):
    id: UUID
    agent_run_id: UUID
    model: str
    tokens_input: int
    tokens_output: int
    cache_hit: bool
    created_at: datetime

    model_config = {"from_attributes": True}
