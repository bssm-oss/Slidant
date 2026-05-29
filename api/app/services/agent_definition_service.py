from uuid import UUID

from fastapi import HTTPException, status

from app.db.uow import UnitOfWork
from app.models.agent import AgentDefinition


async def list_agents(uow: UnitOfWork, user_id: UUID) -> dict:
    system = await uow.agent_definitions.list_system()
    user = await uow.agent_definitions.list_by_user(user_id)
    return {"system": system, "custom": user}


async def create_agent(
    uow: UnitOfWork,
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
    uow.agent_definitions.add(agent)
    await uow.flush()
    await uow.refresh(agent)
    return agent


async def delete_agent(uow: UnitOfWork, user_id: UUID, agent_id: UUID) -> None:
    agent = await uow.agent_definitions.get(agent_id)
    if not agent or agent.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")
    if agent.is_system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete system agent")
    await uow.agent_definitions.delete(agent)
