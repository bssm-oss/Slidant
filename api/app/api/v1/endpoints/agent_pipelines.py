from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import CurrentUser, UoW
from app.models.agent_pipeline import AgentPipeline, PipelineStep

router = APIRouter(prefix="/projects/{project_id}/pipelines", tags=["pipelines"])
global_router = APIRouter(prefix="/pipelines", tags=["pipelines"])


class StepSchema(BaseModel):
    step_order: int
    agent_definition_id: UUID
    command_template: str


class PipelineCreate(BaseModel):
    name: str
    steps: list[StepSchema]


class PipelineResponse(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    steps: list[dict]
    created_at: str


@router.get("", response_model=list[PipelineResponse])
async def list_pipelines(project_id: UUID, current_user: CurrentUser, uow: UoW):
    project = await uow.projects.get(project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    pipelines = await uow.pipelines.list_by_project(project_id)
    result = []
    for p in pipelines:
        steps = await uow.pipeline_steps.list_by_pipeline(p.id)
        result.append(
            PipelineResponse(
                id=p.id,
                project_id=p.project_id,
                name=p.name,
                steps=[
                    {
                        "id": str(s.id),
                        "step_order": s.step_order,
                        "agent_definition_id": str(s.agent_definition_id),
                        "command_template": s.command_template,
                    }
                    for s in steps
                ],
                created_at=p.created_at.isoformat(),
            )
        )
    return result


@router.post("", response_model=PipelineResponse, status_code=201)
async def create_pipeline(
    project_id: UUID,
    body: PipelineCreate,
    current_user: CurrentUser,
    uow: UoW,
):
    project = await uow.projects.get(project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    pipeline = AgentPipeline(project_id=project_id, name=body.name)
    uow.pipelines.add(pipeline)
    await uow.flush()
    await uow.refresh(pipeline)
    steps = []
    for step_data in body.steps:
        step = PipelineStep(
            pipeline_id=pipeline.id,
            step_order=step_data.step_order,
            agent_definition_id=step_data.agent_definition_id,
            command_template=step_data.command_template,
        )
        uow.pipeline_steps.add(step)
        steps.append(step)
    await uow.flush()
    return PipelineResponse(
        id=pipeline.id,
        project_id=pipeline.project_id,
        name=pipeline.name,
        steps=[
            {
                "id": str(s.id),
                "step_order": s.step_order,
                "agent_definition_id": str(s.agent_definition_id),
                "command_template": s.command_template,
            }
            for s in steps
        ],
        created_at=pipeline.created_at.isoformat(),
    )


@router.delete("/{pipeline_id}", status_code=204)
async def delete_pipeline(
    project_id: UUID,
    pipeline_id: UUID,
    current_user: CurrentUser,
    uow: UoW,
):
    project = await uow.projects.get(project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    pipeline = await uow.pipelines.get(pipeline_id)
    if not pipeline or pipeline.project_id != project_id:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    steps = await uow.pipeline_steps.list_by_pipeline(pipeline_id)
    for step in steps:
        await uow.pipeline_steps.delete(step)
    await uow.pipelines.delete(pipeline)


# ── 전체 사용자 파이프라인 조회 (라이브러리) ─────────────────────────────────

async def _pipeline_to_response(uow, p: AgentPipeline) -> PipelineResponse:
    steps = await uow.pipeline_steps.list_by_pipeline(p.id)
    return PipelineResponse(
        id=p.id,
        project_id=p.project_id,
        name=p.name,
        steps=[
            {
                "id": str(s.id),
                "step_order": s.step_order,
                "agent_definition_id": str(s.agent_definition_id),
                "command_template": s.command_template,
            }
            for s in steps
        ],
        created_at=p.created_at.isoformat(),
    )


@global_router.get("", response_model=list[PipelineResponse])
async def list_all_user_pipelines(current_user: CurrentUser, uow: UoW):
    """사용자의 모든 프로젝트에 걸친 파이프라인 목록 (불러오기용)"""
    from sqlalchemy import select as sa_select
    from app.models.project import Project
    result = await uow.session.execute(
        sa_select(Project).where(Project.owner_id == current_user.id)
    )
    projects = list(result.scalars().all())

    all_pipelines: list[PipelineResponse] = []
    for project in projects:
        pipelines = await uow.pipelines.list_by_project(project.id)
        for p in pipelines:
            all_pipelines.append(await _pipeline_to_response(uow, p))
    return all_pipelines


@global_router.post("/{pipeline_id}/clone", response_model=PipelineResponse, status_code=201)
async def clone_pipeline_to_project(
    pipeline_id: UUID,
    target_project_id: UUID,
    current_user: CurrentUser,
    uow: UoW,
):
    """다른 프로젝트의 파이프라인을 현재 프로젝트로 복사"""
    source = await uow.pipelines.get(pipeline_id)
    if not source:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    target_project = await uow.projects.get(target_project_id)
    if not target_project or target_project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    new_pipeline = AgentPipeline(project_id=target_project_id, name=source.name)
    uow.pipelines.add(new_pipeline)
    await uow.flush()
    await uow.refresh(new_pipeline)

    source_steps = await uow.pipeline_steps.list_by_pipeline(pipeline_id)
    new_steps = []
    for s in source_steps:
        step = PipelineStep(
            pipeline_id=new_pipeline.id,
            step_order=s.step_order,
            agent_definition_id=s.agent_definition_id,
            command_template=s.command_template,
        )
        uow.pipeline_steps.add(step)
        new_steps.append(step)
    await uow.flush()

    return PipelineResponse(
        id=new_pipeline.id,
        project_id=new_pipeline.project_id,
        name=new_pipeline.name,
        steps=[
            {
                "id": str(s.id),
                "step_order": s.step_order,
                "agent_definition_id": str(s.agent_definition_id),
                "command_template": s.command_template,
            }
            for s in new_steps
        ],
        created_at=new_pipeline.created_at.isoformat(),
    )
