from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func

from app.core.deps import CurrentUser, UoW
from app.models.slide import Slide
from app.models.slide_history import SlideHistory
from app.schemas.project import (
    ComponentCreate, ComponentPatchRequest, ComponentResponse,
    ComponentUpdate, ProjectCreate, ProjectResponse, ProjectUpdate,
    SlideCreate, SlideReorder, SlideResponse,
)
from app.services import project_service

router = APIRouter(prefix="/projects", tags=["projects"])


class SlideHistoryResponse(BaseModel):
    id: UUID
    slide_id: UUID
    version: int
    reason: str
    created_at: datetime

    model_config = {"from_attributes": True}


async def _archive_snapshot(uow, slide_id: UUID, reason: str) -> None:
    """현재 슬라이드 상태를 SlideHistory로 저장하고 version 증가."""
    slide = await uow.slides.get(slide_id)
    if not slide:
        return
    uow.slide_history.add(SlideHistory(
        slide_id=slide_id,
        version=slide.version,
        content=list(slide.content or []),
        reason=reason,
    ))
    slide.version += 1


@router.get("", response_model=list[ProjectResponse])
async def list_projects(current_user: CurrentUser, uow: UoW):
    projects = await project_service.list_projects(uow.projects, current_user.id)
    if not projects:
        return []
    project_ids = [p.id for p in projects]
    counts_result = await uow.session.execute(
        select(Slide.project_id, func.count(Slide.id).label("cnt"))
        .where(Slide.project_id.in_(project_ids))
        .group_by(Slide.project_id)
    )
    count_map = {row.project_id: row.cnt for row in counts_result}
    return [
        ProjectResponse(
            id=p.id,
            owner_id=p.owner_id,
            title=p.title,
            slide_count=count_map.get(p.id, 0),
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
        for p in projects
    ]


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(body: ProjectCreate, current_user: CurrentUser, uow: UoW):
    return await project_service.create_project(uow.projects, uow.slides, current_user.id, body.title)


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: UUID, current_user: CurrentUser, uow: UoW):
    return await project_service.get_project_or_404(uow.projects, project_id, current_user.id)


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: UUID, body: ProjectUpdate, current_user: CurrentUser, uow: UoW):
    return await project_service.update_project_title(uow.projects, project_id, current_user.id, body.title)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: UUID, current_user: CurrentUser, uow: UoW):
    await project_service.delete_project(uow.projects, project_id, current_user.id)


@router.get("/{project_id}/slides", response_model=list[SlideResponse])
async def list_slides(project_id: UUID, current_user: CurrentUser, uow: UoW):
    slides = await project_service.list_slides(uow.projects, uow.slides, project_id, current_user.id)
    return [SlideResponse.from_slide(s) for s in slides]


@router.post("/{project_id}/slides", response_model=SlideResponse, status_code=status.HTTP_201_CREATED)
async def create_slide(project_id: UUID, body: SlideCreate, current_user: CurrentUser, uow: UoW):
    slide = await project_service.create_slide(uow.projects, uow.slides, project_id, current_user.id, body.title)
    return SlideResponse.from_slide(slide)


@router.delete("/{project_id}/slides/{slide_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_slide(project_id: UUID, slide_id: UUID, current_user: CurrentUser, uow: UoW):
    await project_service.delete_slide(uow.projects, uow.slides, project_id, current_user.id, slide_id)


@router.patch("/{project_id}/slides/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_slides(project_id: UUID, body: SlideReorder, current_user: CurrentUser, uow: UoW):
    await project_service.reorder_slides(uow.projects, uow.slides, project_id, current_user.id, body.slide_ids)


@router.get("/{project_id}/slides/{slide_id}/components", response_model=list[ComponentResponse])
async def list_components(project_id: UUID, slide_id: UUID, current_user: CurrentUser, uow: UoW):
    return await project_service.list_components(uow.projects, uow.slides, project_id, current_user.id, slide_id)


@router.post("/{project_id}/slides/{slide_id}/components", response_model=ComponentResponse, status_code=status.HTTP_201_CREATED)
async def create_component(project_id: UUID, slide_id: UUID, body: ComponentCreate, current_user: CurrentUser, uow: UoW):
    await _archive_snapshot(uow, slide_id, "사용자: 컴포넌트 추가")
    return await project_service.create_component(
        uow.projects, uow.slides, project_id, current_user.id, slide_id,
        body.type, body.properties, body.parent_id, body.order,
    )


@router.patch("/{project_id}/slides/{slide_id}/components/{component_id}", response_model=ComponentResponse)
async def update_component(project_id: UUID, slide_id: UUID, component_id: str, body: ComponentUpdate, current_user: CurrentUser, uow: UoW):
    await _archive_snapshot(uow, slide_id, f"사용자: 컴포넌트 수정 ({component_id[:8]})")
    return await project_service.update_component(
        uow.projects, uow.slides, project_id, current_user.id, slide_id, component_id,
        body.properties, body.order,
    )


@router.post("/{project_id}/slides/{slide_id}/components/patch", response_model=list[ComponentResponse])
async def apply_json_patch(project_id: UUID, slide_id: UUID, body: ComponentPatchRequest, current_user: CurrentUser, uow: UoW):
    await _archive_snapshot(uow, slide_id, f"사용자: 패치 적용 ({len(body.ops)}개 ops)")
    return await project_service.apply_json_patch(
        uow.projects, uow.slides, project_id, current_user.id, slide_id, body.ops
    )


@router.delete("/{project_id}/slides/{slide_id}/components/{component_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_component(project_id: UUID, slide_id: UUID, component_id: str, current_user: CurrentUser, uow: UoW):
    await _archive_snapshot(uow, slide_id, f"사용자: 컴포넌트 삭제 ({component_id[:8]})")
    await project_service.delete_component(
        uow.projects, uow.slides, project_id, current_user.id, slide_id, component_id
    )


@router.get("/{project_id}/slides/{slide_id}/history", response_model=list[SlideHistoryResponse])
async def list_history(project_id: UUID, slide_id: UUID, current_user: CurrentUser, uow: UoW):
    await project_service.get_slide(uow.projects, uow.slides, project_id, current_user.id, slide_id)
    return await uow.slide_history.list_by_slide(slide_id)


@router.post("/{project_id}/slides/{slide_id}/history/{history_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
async def restore_from_history_endpoint(project_id: UUID, slide_id: UUID, history_id: UUID, current_user: CurrentUser, uow: UoW):
    await project_service.get_slide(uow.projects, uow.slides, project_id, current_user.id, slide_id)
    from app.services.slide_history_service import restore_from_history
    await restore_from_history(uow, slide_id, history_id)
