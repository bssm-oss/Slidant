from datetime import datetime
from uuid import UUID

from app.models.agent import AgentDefinition, AgentRun, LlmLog
from app.repositories.agent import AgentDefinitionRepository, AgentRunRepository, LlmLogRepository
from app.repositories.api_key import ApiKeyRepository
from app.repositories.component import ComponentRepository


async def resolve_api_key(
    api_key_repo: ApiKeyRepository,
    user_id: UUID,
) -> tuple[object | None, str]:
    """openrouter 우선, 없으면 anthropic. (api_key, provider) 반환"""
    key = await api_key_repo.get_active(user_id, "openrouter")
    if key:
        return key, "openrouter"
    key = await api_key_repo.get_active(user_id, "anthropic")
    return key, "anthropic"


async def get_or_create_agent_def(
    agent_def_repo: AgentDefinitionRepository,
    role: str,
) -> AgentDefinition:
    agent_def = await agent_def_repo.get_system_by_role(role)
    if not agent_def:
        agent_def = AgentDefinition(
            name=f"{role.capitalize()}Agent",
            role=role,
            is_system=True,
        )
        agent_def_repo.add(agent_def)
        await agent_def_repo.session.flush()
    return agent_def


async def create_agent_run(
    agent_run_repo: AgentRunRepository,
    project_id: UUID,
    agent_definition_id: UUID,
) -> AgentRun:
    agent_run = AgentRun(
        project_id=project_id,
        agent_definition_id=agent_definition_id,
        status="running",
        started_at=datetime.utcnow(),
    )
    agent_run_repo.add(agent_run)
    await agent_run_repo.session.flush()
    return agent_run


async def apply_patches(
    component_repo: ComponentRepository,
    slide_id: UUID,
    patches: list[dict],
) -> None:
    for op in patches:
        path_parts = op.get("path", "").strip("/").split("/")
        if len(path_parts) < 2:
            continue
        try:
            comp_uuid = UUID(path_parts[0])
        except ValueError:
            continue
        comp = await component_repo.get(comp_uuid)
        if not comp or comp.slide_id != slide_id:
            continue
        field = path_parts[1]
        if field == "properties" and len(path_parts) > 2:
            comp.properties = {**comp.properties, path_parts[2]: op.get("value")}
        elif field == "order":
            comp.order = op.get("value")
        comp.updated_at = datetime.utcnow()


async def finalize_agent_run(
    agent_run_repo: AgentRunRepository,
    llm_log_repo: LlmLogRepository,
    agent_run: AgentRun,
    command: str,
    patches: list[dict],
    status: str = "done",
    error: str = "",
) -> None:
    agent_run.status = status
    agent_run.finished_at = datetime.utcnow()
    llm_log = LlmLog(
        agent_run_id=agent_run.id,
        model="via-openrouter" if status == "done" else "n/a",
        prompt=command,
        response=str(patches) if status == "done" else error,
        tokens_input=0,
        tokens_output=0,
        cache_hit=False,
    )
    llm_log_repo.add(llm_log)
    await agent_run_repo.session.flush()
    await agent_run_repo.session.refresh(agent_run)
