from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status

from app.db.uow import UnitOfWork
from app.models.component import Component
from app.models.project import Project
from app.models.slide import Slide


async def list_projects(uow: UnitOfWork, owner_id: UUID) -> list[Project]:
    return await uow.projects.list_by_owner(owner_id)


async def create_project(uow: UnitOfWork, owner_id: UUID, title: str) -> Project:
    project = Project(owner_id=owner_id, title=title)
    uow.projects.add(project)
    await uow.flush()
    # 첫 번째 빈 슬라이드 자동 생성
    slide = Slide(project_id=project.id, order=0)
    uow.slides.add(slide)
    await uow.flush()
    await uow.refresh(project)
    return project


async def get_project_or_404(uow: UnitOfWork, project_id: UUID, owner_id: UUID) -> Project:
    project = await uow.projects.get_owned(project_id, owner_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


async def update_project_title(uow: UnitOfWork, project_id: UUID, owner_id: UUID, title: str) -> Project:
    project = await get_project_or_404(uow, project_id, owner_id)
    project.title = title
    project.updated_at = datetime.utcnow()
    await uow.flush()
    await uow.refresh(project)
    return project


async def delete_project(uow: UnitOfWork, project_id: UUID, owner_id: UUID) -> None:
    project = await get_project_or_404(uow, project_id, owner_id)
    await uow.projects.delete(project)


async def list_slides(uow: UnitOfWork, project_id: UUID, owner_id: UUID) -> list[Slide]:
    await get_project_or_404(uow, project_id, owner_id)
    return await uow.slides.list_by_project(project_id)


async def create_slide(uow: UnitOfWork, project_id: UUID, owner_id: UUID, title: str | None) -> Slide:
    await get_project_or_404(uow, project_id, owner_id)
    order = await uow.slides.get_last_order(project_id)
    slide = Slide(project_id=project_id, order=order, title=title)
    uow.slides.add(slide)
    await uow.flush()
    await uow.refresh(slide)
    return slide


async def delete_slide(uow: UnitOfWork, project_id: UUID, owner_id: UUID, slide_id: UUID) -> None:
    await get_project_or_404(uow, project_id, owner_id)
    slide = await uow.slides.get(slide_id)
    if not slide or slide.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Slide not found")
    await uow.slides.delete(slide)


async def reorder_slides(uow: UnitOfWork, project_id: UUID, owner_id: UUID, slide_ids: list[UUID]) -> None:
    await get_project_or_404(uow, project_id, owner_id)
    for i, slide_id in enumerate(slide_ids):
        slide = await uow.slides.get(slide_id)
        if slide and slide.project_id == project_id:
            slide.order = i


async def list_components(uow: UnitOfWork, project_id: UUID, owner_id: UUID, slide_id: UUID) -> list[Component]:
    await get_project_or_404(uow, project_id, owner_id)
    return await uow.components.list_by_slide(slide_id)


async def create_component(
    uow: UnitOfWork, project_id: UUID, owner_id: UUID, slide_id: UUID,
    type: str, properties: dict, parent_id: UUID | None, order: int,
) -> Component:
    await get_project_or_404(uow, project_id, owner_id)
    comp = Component(slide_id=slide_id, type=type, properties=properties, parent_id=parent_id, order=order)
    uow.components.add(comp)
    await uow.flush()
    await uow.refresh(comp)
    return comp


async def update_component(
    uow: UnitOfWork, project_id: UUID, owner_id: UUID,
    slide_id: UUID, component_id: UUID,
    properties: dict | None, order: int | None,
) -> Component:
    await get_project_or_404(uow, project_id, owner_id)
    comp = await uow.components.get(component_id)
    if not comp or comp.slide_id != slide_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    if properties is not None:
        comp.properties = properties
    if order is not None:
        comp.order = order
    comp.updated_at = datetime.utcnow()
    await uow.flush()
    await uow.refresh(comp)
    return comp


async def delete_component(
    uow: UnitOfWork, project_id: UUID, owner_id: UUID, slide_id: UUID, component_id: UUID,
) -> None:
    await get_project_or_404(uow, project_id, owner_id)
    comp = await uow.components.get(component_id)
    if not comp or comp.slide_id != slide_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    await uow.components.delete(comp)


async def apply_json_patch(
    uow: UnitOfWork, project_id: UUID, owner_id: UUID, slide_id: UUID, ops: list[dict],
) -> list[Component]:
    await get_project_or_404(uow, project_id, owner_id)
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
        comp = await uow.components.get(comp_id)
        if not comp or comp.slide_id != slide_id:
            continue
        if operation == "replace" and len(path_parts) > 1:
            if path_parts[1] == "properties" and len(path_parts) > 2:
                comp.properties = {**comp.properties, path_parts[2]: op.get("value")}
            elif path_parts[1] == "order":
                comp.order = op.get("value")
        elif operation == "remove":
            await uow.components.delete(comp)
        comp.updated_at = datetime.utcnow()
    return await uow.components.list_by_slide(slide_id)
