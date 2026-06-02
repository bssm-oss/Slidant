from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import CurrentUser, UoW
from app.models.agent_pipeline import AgentPipeline, PipelineStep

router = APIRouter(prefix="/projects/{project_id}/pipelines", tags=["pipelines"])


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
