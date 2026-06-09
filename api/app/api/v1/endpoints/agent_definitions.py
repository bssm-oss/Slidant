from uuid import UUID

from fastapi import APIRouter, status

from app.core.deps import CurrentUser, UoW
from app.schemas.agent_definition import (
    AgentDefinitionClone,
    AgentDefinitionCreate,
    AgentDefinitionResponse,
    AgentDefinitionUpdate,
    AgentListResponse,
)
from app.services import agent_definition_service

router = APIRouter(prefix="/agent-definitions", tags=["agent-definitions"])


@router.get("", response_model=AgentListResponse)
async def list_agents(current_user: CurrentUser, uow: UoW, project_id: UUID | None = None):
    return await agent_definition_service.list_agents(uow.agent_definitions, current_user.id, project_id)


@router.post("", response_model=AgentDefinitionResponse, status_code=status.HTTP_201_CREATED)
async def create_agent(body: AgentDefinitionCreate, current_user: CurrentUser, uow: UoW):
    agent = await agent_definition_service.create_agent(
        uow.agent_definitions, current_user.id,
        body.name, body.role, body.description, body.config,
        project_id=body.project_id,
    )
    await uow.commit()
    return agent


@router.patch("/{agent_id}", response_model=AgentDefinitionResponse)
async def update_agent(agent_id: UUID, body: AgentDefinitionUpdate, current_user: CurrentUser, uow: UoW):
    agent = await agent_definition_service.update_agent(
        uow.agent_definitions, current_user.id, agent_id,
        body.name, body.description, body.config,
    )
    await uow.commit()
    return agent


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(agent_id: UUID, current_user: CurrentUser, uow: UoW):
    await agent_definition_service.delete_agent(uow.agent_definitions, current_user.id, agent_id)
    await uow.commit()


@router.post("/{agent_id}/clone", response_model=AgentDefinitionResponse, status_code=status.HTTP_201_CREATED)
async def clone_agent(agent_id: UUID, body: AgentDefinitionClone, current_user: CurrentUser, uow: UoW):
    agent = await agent_definition_service.clone_to_project(
        uow.agent_definitions, current_user.id, agent_id, body.project_id,
    )
    await uow.commit()
    return agent
