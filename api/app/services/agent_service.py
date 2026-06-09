from datetime import datetime
from uuid import UUID

from app.models.agent import AgentDefinition, AgentRun, LlmLog
from app.repositories.agent import AgentDefinitionRepository, AgentRunRepository, LlmLogRepository
from app.repositories.api_key import ApiKeyRepository
from app.repositories.slide import SlideRepository
from app.services import slide_content


async def resolve_api_key(
    api_key_repo: ApiKeyRepository,
    user_id: UUID,
) -> tuple[object | None, str]:
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


async def resolve_agent_def(
    agent_def_repo: AgentDefinitionRepository,
    agent_definition_id: UUID | None,
    role: str,
) -> tuple[AgentDefinition, str | None]:
    """
    Returns (AgentDefinition, system_prompt).
    agent_definition_id 지정 시 해당 정의 사용 (커스텀 포함).
    미지정 시 role 기반 시스템 에이전트로 fallback.
    system_prompt는 config.system_prompt → config.description 순으로 추출.
    """
    agent_def = None
    if agent_definition_id:
        agent_def = await agent_def_repo.get(agent_definition_id)

    if not agent_def:
        agent_def = await get_or_create_agent_def(agent_def_repo, role)

    config = agent_def.config or {}
    system_prompt: str | None = config.get("system_prompt") or config.get("description") or None
    return agent_def, system_prompt


async def create_agent_run(
    agent_run_repo: AgentRunRepository,
    project_id: UUID,
    agent_definition_id: UUID,
    task_description: str | None = None,
    agent_name: str | None = None,
    affected_slide_id: UUID | None = None,
    user_id: UUID | None = None,
) -> AgentRun:
    agent_run = AgentRun(
        project_id=project_id,
        agent_definition_id=agent_definition_id,
        status="running",
        started_at=datetime.utcnow(),
        task_description=task_description,
        agent_name=agent_name,
        affected_slide_id=affected_slide_id,
        user_id=user_id,
    )
    agent_run_repo.add(agent_run)
    await agent_run_repo.session.flush()
    return agent_run


async def apply_patches(
    slide_repo: SlideRepository,
    slide_id: UUID,
    patches: list[dict],
) -> None:
    s = await slide_repo.get(slide_id)
    if s:
        slide_content.apply_patches(s, patches)
        s.updated_at = datetime.utcnow()


async def finalize_agent_run(
    agent_run_repo: AgentRunRepository,
    llm_log_repo: LlmLogRepository,
    agent_run: AgentRun,
    command: str,
    patches: list[dict],
    status: str = "done",
    error: str = "",
    result_summary: str | None = None,
    provider: str = "unknown",
) -> None:
    agent_run.status = status
    agent_run.finished_at = datetime.utcnow()
    if result_summary is not None:
        agent_run.result_summary = result_summary
    llm_log = LlmLog(
        agent_run_id=agent_run.id,
        model=provider if status == "done" else "n/a",
        prompt=command,
        response=str(patches) if status == "done" else error,
        tokens_input=0,
        tokens_output=0,
        cache_hit=False,
    )
    llm_log_repo.add(llm_log)
    await agent_run_repo.session.flush()
    await agent_run_repo.session.refresh(agent_run)
