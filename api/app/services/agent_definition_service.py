from uuid import UUID

from fastapi import HTTPException, status

from app.models.agent import AgentDefinition
from app.repositories.agent import AgentDefinitionRepository


async def list_agents(agent_def_repo: AgentDefinitionRepository, user_id: UUID) -> dict:
    system = await agent_def_repo.list_system()
    user = await agent_def_repo.list_by_user(user_id)
    return {"system": system, "custom": user}


async def create_agent(
    agent_def_repo: AgentDefinitionRepository,
    user_id: UUID,
    name: str,
    role: str,
    description: str,
    config: dict,
) -> AgentDefinition:
    agent = AgentDefinition(
        user_id=user_id,
        name=name,
        role=role,
        config={**config, "description": description},
        is_system=False,
    )
    agent_def_repo.add(agent)
    await agent_def_repo.session.flush()
    await agent_def_repo.session.refresh(agent)
    return agent


async def delete_agent(agent_def_repo: AgentDefinitionRepository, user_id: UUID, agent_id: UUID) -> None:
    agent = await agent_def_repo.get(agent_id)
    if not agent or agent.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")
    if agent.is_system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete system agent")
    await agent_def_repo.delete(agent)
