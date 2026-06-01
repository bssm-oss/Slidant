from uuid import UUID

from pydantic import BaseModel


class AgentDefinitionCreate(BaseModel):
    name: str
    role: str = "custom"
    description: str = ""
    config: dict = {}
    project_id: UUID | None = None


class AgentDefinitionUpdate(BaseModel):
    name: str
    description: str = ""
    config: dict = {}


class AgentDefinitionClone(BaseModel):
    project_id: UUID


class AgentDefinitionResponse(BaseModel):
    id: UUID
    name: str
    role: str
    is_system: bool
    project_id: UUID | None
    config: dict

    model_config = {"from_attributes": True}


class AgentListResponse(BaseModel):
    system: list[AgentDefinitionResponse]
    library: list[AgentDefinitionResponse]
    project: list[AgentDefinitionResponse]
