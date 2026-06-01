from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status

from app.models.project import Project
from app.models.slide import Slide
from app.repositories.project import ProjectRepository
from app.repositories.slide import SlideRepository
from app.services import slide_content


async def _get_project_or_404(project_repo: ProjectRepository, project_id: UUID, owner_id: UUID) -> Project:
    project = await project_repo.get_owned(project_id, owner_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


async def _get_slide_or_404(slide_repo: SlideRepository, slide_id: UUID, project_id: UUID) -> Slide:
    slide = await slide_repo.get(slide_id)
    if not slide or slide.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Slide not found")
    return slide


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
    slide = Slide(project_id=project.id, order=0, content=[])
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
    slide = Slide(project_id=project_id, order=order, title=title, content=[])
    slide_repo.add(slide)
    await slide_repo.session.flush()
    await slide_repo.session.refresh(slide)
    return slide


async def get_slide(
    project_repo: ProjectRepository, slide_repo: SlideRepository,
    project_id: UUID, owner_id: UUID, slide_id: UUID,
) -> "Slide":
    await _get_project_or_404(project_repo, project_id, owner_id)
    return await _get_slide_or_404(slide_repo, slide_id, project_id)


async def delete_slide(
    project_repo: ProjectRepository, slide_repo: SlideRepository,
    project_id: UUID, owner_id: UUID, slide_id: UUID,
) -> None:
    await _get_project_or_404(project_repo, project_id, owner_id)
    slide = await _get_slide_or_404(slide_repo, slide_id, project_id)
    await slide_repo.delete(slide)


async def reorder_slides(
    project_repo: ProjectRepository, slide_repo: SlideRepository,
    project_id: UUID, owner_id: UUID, slide_ids: list[UUID],
) -> None:
    await _get_project_or_404(project_repo, project_id, owner_id)
    for i, sid in enumerate(slide_ids):
        s = await slide_repo.get(sid)
        if s and s.project_id == project_id:
            s.order = i


async def list_components(
    project_repo: ProjectRepository, slide_repo: SlideRepository,
    project_id: UUID, owner_id: UUID, slide_id: UUID,
) -> list[dict]:
    await _get_project_or_404(project_repo, project_id, owner_id)
    s = await _get_slide_or_404(slide_repo, slide_id, project_id)
    return slide_content.list_components(s)


async def create_component(
    project_repo: ProjectRepository, slide_repo: SlideRepository,
    project_id: UUID, owner_id: UUID, slide_id: UUID,
    type: str, properties: dict, parent_id: str | None, order: int,
) -> dict:
    await _get_project_or_404(project_repo, project_id, owner_id)
    s = await _get_slide_or_404(slide_repo, slide_id, project_id)
    comp = slide_content.add_component(s, type, properties, parent_id, order)
    s.updated_at = datetime.utcnow()
    await slide_repo.session.flush()
    return comp


async def update_component(
    project_repo: ProjectRepository, slide_repo: SlideRepository,
    project_id: UUID, owner_id: UUID, slide_id: UUID, component_id: str,
    properties: dict | None, order: int | None,
) -> dict:
    await _get_project_or_404(project_repo, project_id, owner_id)
    s = await _get_slide_or_404(slide_repo, slide_id, project_id)
    comp = slide_content.update_component(s, component_id, properties, order)
    if not comp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    s.updated_at = datetime.utcnow()
    await slide_repo.session.flush()
    return comp


async def delete_component(
    project_repo: ProjectRepository, slide_repo: SlideRepository,
    project_id: UUID, owner_id: UUID, slide_id: UUID, component_id: str,
) -> None:
    await _get_project_or_404(project_repo, project_id, owner_id)
    s = await _get_slide_or_404(slide_repo, slide_id, project_id)
    if not slide_content.remove_component(s, component_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    s.updated_at = datetime.utcnow()
    await slide_repo.session.flush()


async def create_slide_with_components(
    slide_repo: SlideRepository,
    project_id: UUID,
    title: str | None,
    components: list[dict],
) -> Slide:
    from app.services.slide_content import add_component
    order = await slide_repo.get_last_order(project_id)
    slide = Slide(project_id=project_id, order=order, title=title, content=[])
    for comp in components:
        add_component(
            slide,
            type=comp.get("type", "text"),
            properties=comp.get("properties", {}),
            parent_id=comp.get("parent_id"),
            order=comp.get("order", 0),
        )
    slide_repo.add(slide)
    await slide_repo.session.flush()
    await slide_repo.session.refresh(slide)
    return slide


async def apply_json_patch(
    project_repo: ProjectRepository, slide_repo: SlideRepository,
    project_id: UUID, owner_id: UUID, slide_id: UUID, ops: list[dict],
) -> list[dict]:
    await _get_project_or_404(project_repo, project_id, owner_id)
    s = await _get_slide_or_404(slide_repo, slide_id, project_id)
    slide_content.apply_patches(s, ops)
    s.updated_at = datetime.utcnow()
    await slide_repo.session.flush()
    return slide_content.list_components(s)
