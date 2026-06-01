from uuid import UUID

from fastapi import APIRouter, status

from app.core.deps import CurrentUser, UoW
from app.schemas.project import (
    ComponentCreate, ComponentPatchRequest, ComponentResponse,
    ComponentUpdate, ProjectCreate, ProjectResponse, ProjectUpdate,
    SlideCreate, SlideReorder, SlideResponse,
)
from app.services import project_service

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectResponse])
async def list_projects(current_user: CurrentUser, uow: UoW):
    return await project_service.list_projects(uow.projects, current_user.id)


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
    return await project_service.create_component(
        uow.projects, uow.slides, project_id, current_user.id, slide_id,
        body.type, body.properties, body.parent_id, body.order,
    )


@router.patch("/{project_id}/slides/{slide_id}/components/{component_id}", response_model=ComponentResponse)
async def update_component(project_id: UUID, slide_id: UUID, component_id: str, body: ComponentUpdate, current_user: CurrentUser, uow: UoW):
    return await project_service.update_component(
        uow.projects, uow.slides, project_id, current_user.id, slide_id, component_id,
        body.properties, body.order,
    )


@router.post("/{project_id}/slides/{slide_id}/components/patch", response_model=list[ComponentResponse])
async def apply_json_patch(project_id: UUID, slide_id: UUID, body: ComponentPatchRequest, current_user: CurrentUser, uow: UoW):
    return await project_service.apply_json_patch(
        uow.projects, uow.slides, project_id, current_user.id, slide_id, body.ops
    )


@router.delete("/{project_id}/slides/{slide_id}/components/{component_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_component(project_id: UUID, slide_id: UUID, component_id: str, current_user: CurrentUser, uow: UoW):
    await project_service.delete_component(
        uow.projects, uow.slides, project_id, current_user.id, slide_id, component_id
    )
