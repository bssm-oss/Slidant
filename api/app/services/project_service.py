from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status

from app.models.component import Component
from app.models.project import Project
from app.models.slide import Slide
from app.repositories.component import ComponentRepository
from app.repositories.project import ProjectRepository
from app.repositories.slide import SlideRepository


async def _get_project_or_404(project_repo: ProjectRepository, project_id: UUID, owner_id: UUID) -> Project:
    project = await project_repo.get_owned(project_id, owner_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


async def list_projects(project_repo: ProjectRepository, owner_id: UUID) -> list[Project]:
    return await project_repo.list_by_owner(owner_id)


async def create_project(
    project_repo: ProjectRepository,
    slide_repo: SlideRepository,
    owner_id: UUID,
    title: str,
) -> Project:
    project = Project(owner_id=owner_id, title=title)
    project_repo.add(project)
    await project_repo.session.flush()
    # 첫 번째 빈 슬라이드 자동 생성
    slide = Slide(project_id=project.id, order=0)
    slide_repo.add(slide)
    await project_repo.session.flush()
    await project_repo.session.refresh(project)
    return project


async def get_project_or_404(project_repo: ProjectRepository, project_id: UUID, owner_id: UUID) -> Project:
    return await _get_project_or_404(project_repo, project_id, owner_id)


async def update_project_title(
    project_repo: ProjectRepository, project_id: UUID, owner_id: UUID, title: str
) -> Project:
    project = await _get_project_or_404(project_repo, project_id, owner_id)
    project.title = title
    project.updated_at = datetime.utcnow()
    await project_repo.session.flush()
    await project_repo.session.refresh(project)
    return project


async def delete_project(project_repo: ProjectRepository, project_id: UUID, owner_id: UUID) -> None:
    project = await _get_project_or_404(project_repo, project_id, owner_id)
    await project_repo.delete(project)


async def list_slides(
    project_repo: ProjectRepository, slide_repo: SlideRepository, project_id: UUID, owner_id: UUID
) -> list[Slide]:
    await _get_project_or_404(project_repo, project_id, owner_id)
    return await slide_repo.list_by_project(project_id)


async def create_slide(
    project_repo: ProjectRepository, slide_repo: SlideRepository,
    project_id: UUID, owner_id: UUID, title: str | None,
) -> Slide:
    await _get_project_or_404(project_repo, project_id, owner_id)
    order = await slide_repo.get_last_order(project_id)
    slide = Slide(project_id=project_id, order=order, title=title)
    slide_repo.add(slide)
    await slide_repo.session.flush()
    await slide_repo.session.refresh(slide)
    return slide


async def delete_slide(
    project_repo: ProjectRepository, slide_repo: SlideRepository,
    project_id: UUID, owner_id: UUID, slide_id: UUID,
) -> None:
    await _get_project_or_404(project_repo, project_id, owner_id)
    slide = await slide_repo.get(slide_id)
    if not slide or slide.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Slide not found")
    await slide_repo.delete(slide)


async def reorder_slides(
    project_repo: ProjectRepository, slide_repo: SlideRepository,
    project_id: UUID, owner_id: UUID, slide_ids: list[UUID],
) -> None:
    await _get_project_or_404(project_repo, project_id, owner_id)
    for i, sid in enumerate(slide_ids):
        slide = await slide_repo.get(sid)
        if slide and slide.project_id == project_id:
            slide.order = i


async def list_components(
    project_repo: ProjectRepository, component_repo: ComponentRepository,
    project_id: UUID, owner_id: UUID, slide_id: UUID,
) -> list[Component]:
    await _get_project_or_404(project_repo, project_id, owner_id)
    return await component_repo.list_by_slide(slide_id)


async def create_component(
    project_repo: ProjectRepository, component_repo: ComponentRepository,
    project_id: UUID, owner_id: UUID, slide_id: UUID,
    type: str, properties: dict, parent_id: UUID | None, order: int,
) -> Component:
    await _get_project_or_404(project_repo, project_id, owner_id)
    comp = Component(slide_id=slide_id, type=type, properties=properties, parent_id=parent_id, order=order)
    component_repo.add(comp)
    await component_repo.session.flush()
    await component_repo.session.refresh(comp)
    return comp


async def update_component(
    project_repo: ProjectRepository, component_repo: ComponentRepository,
    project_id: UUID, owner_id: UUID, slide_id: UUID, component_id: UUID,
    properties: dict | None, order: int | None,
) -> Component:
    await _get_project_or_404(project_repo, project_id, owner_id)
    comp = await component_repo.get(component_id)
    if not comp or comp.slide_id != slide_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    if properties is not None:
        comp.properties = properties
    if order is not None:
        comp.order = order
    comp.updated_at = datetime.utcnow()
    await component_repo.session.flush()
    await component_repo.session.refresh(comp)
    return comp


async def delete_component(
    project_repo: ProjectRepository, component_repo: ComponentRepository,
    project_id: UUID, owner_id: UUID, slide_id: UUID, component_id: UUID,
) -> None:
    await _get_project_or_404(project_repo, project_id, owner_id)
    comp = await component_repo.get(component_id)
    if not comp or comp.slide_id != slide_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    await component_repo.delete(comp)


async def apply_json_patch(
    project_repo: ProjectRepository, component_repo: ComponentRepository,
    project_id: UUID, owner_id: UUID, slide_id: UUID, ops: list[dict],
) -> list[Component]:
    await _get_project_or_404(project_repo, project_id, owner_id)
    for op in ops:
        operation = op.get("op")
        path_parts = op.get("path", "").strip("/").split("/")
        if not path_parts:
            continue
        try:
            from uuid import UUID as _UUID
            comp_id = _UUID(path_parts[0])
        except ValueError:
            continue
        comp = await component_repo.get(comp_id)
        if not comp or comp.slide_id != slide_id:
            continue
        if operation == "replace" and len(path_parts) > 1:
            if path_parts[1] == "properties" and len(path_parts) > 2:
                comp.properties = {**comp.properties, path_parts[2]: op.get("value")}
            elif path_parts[1] == "order":
                comp.order = op.get("value")
        elif operation == "remove":
            await component_repo.delete(comp)
        comp.updated_at = datetime.utcnow()
    return await component_repo.list_by_slide(slide_id)
