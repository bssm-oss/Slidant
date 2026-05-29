from uuid import UUID

from fastapi import APIRouter, status

from app.core.deps import CurrentUser, UoW
from app.schemas.agent_definition import AgentDefinitionCreate, AgentDefinitionResponse, AgentListResponse
from app.services import agent_definition_service

router = APIRouter(prefix="/agent-definitions", tags=["agent-definitions"])


@router.get("", response_model=AgentListResponse)
async def list_agents(current_user: CurrentUser, uow: UoW):
    return await agent_definition_service.list_agents(uow, current_user.id)


@router.post("", response_model=AgentDefinitionResponse, status_code=status.HTTP_201_CREATED)
async def create_agent(body: AgentDefinitionCreate, current_user: CurrentUser, uow: UoW):
    return await agent_definition_service.create_agent(
        uow, current_user.id, body.name, body.role, body.description, body.config
    )


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(agent_id: UUID, current_user: CurrentUser, uow: UoW):
    await agent_definition_service.delete_agent(uow, current_user.id, agent_id)
