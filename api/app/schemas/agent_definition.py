from uuid import UUID

from pydantic import BaseModel


class AgentDefinitionCreate(BaseModel):
    name: str
    role: str = "custom"
    description: str = ""
    config: dict = {}


class AgentDefinitionResponse(BaseModel):
    id: UUID
    name: str
    role: str
    is_system: bool
    config: dict

    model_config = {"from_attributes": True}


class AgentListResponse(BaseModel):
    system: list[AgentDefinitionResponse]
    custom: list[AgentDefinitionResponse]
