from uuid import UUID

from fastapi import HTTPException, status

from app.models.agent import AgentDefinition
from app.repositories.agent import AgentDefinitionRepository


async def list_agents(
    agent_def_repo: AgentDefinitionRepository,
    user_id: UUID,
    project_id: UUID | None = None,
) -> dict:
    system = await agent_def_repo.list_system()
    library = await agent_def_repo.list_by_user(user_id)
    project = await agent_def_repo.list_by_project(user_id, project_id) if project_id else []
    return {"system": system, "library": library, "project": project}


async def create_agent(
    agent_def_repo: AgentDefinitionRepository,
    user_id: UUID,
    name: str,
    role: str,
    description: str,
    config: dict,
    project_id: UUID | None = None,
) -> AgentDefinition:
    agent = AgentDefinition(
        user_id=user_id,
        project_id=project_id,
        name=name,
        role=role,
        config={**config, "description": description},
        is_system=False,
    )
    agent_def_repo.add(agent)
    await agent_def_repo.session.flush()
    await agent_def_repo.session.refresh(agent)
    return agent


async def update_agent(
    agent_def_repo: AgentDefinitionRepository,
    user_id: UUID,
    agent_id: UUID,
    name: str,
    description: str,
    config: dict,
) -> AgentDefinition:
    agent = await agent_def_repo.get(agent_id)
    if not agent or agent.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")
    if agent.is_system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify system agent")
    agent.name = name
    agent.config = {**config, "description": description}
    await agent_def_repo.session.flush()
    await agent_def_repo.session.refresh(agent)
    return agent


async def delete_agent(
    agent_def_repo: AgentDefinitionRepository,
    user_id: UUID,
    agent_id: UUID,
) -> None:
    agent = await agent_def_repo.get(agent_id)
    if not agent or agent.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")
    if agent.is_system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete system agent")
    await agent_def_repo.delete(agent)


async def clone_to_project(
    agent_def_repo: AgentDefinitionRepository,
    user_id: UUID,
    agent_id: UUID,
    project_id: UUID,
) -> AgentDefinition:
    """Clone a system or library agent into a project as a project-scoped copy."""
    source = await agent_def_repo.get(agent_id)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")
    if not source.is_system and source.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    description = source.config.get("description", "") or source.config.get("system_prompt", "")
    extra_config = {k: v for k, v in source.config.items() if k not in ("description",)}
    return await create_agent(
        agent_def_repo, user_id, source.name, source.role,
        str(description), extra_config, project_id=project_id,
    )
