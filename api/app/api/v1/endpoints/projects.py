from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DB
from app.models.project import Project
from app.models.slide import Slide
from app.models.component import Component
from app.schemas.project import (
    ComponentCreate, ComponentPatchRequest, ComponentResponse,
    ComponentUpdate, ProjectCreate, ProjectResponse, ProjectUpdate,
    SlideCreate, SlideReorder, SlideResponse,
)

router = APIRouter(prefix="/projects", tags=["projects"])


# ── Projects ──────────────────────────────────────────────


@router.get("", response_model=list[ProjectResponse])
async def list_projects(current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(Project).where(Project.owner_id == current_user.id).order_by(Project.updated_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(body: ProjectCreate, current_user: CurrentUser, db: DB):
    project = Project(owner_id=current_user.id, title=body.title)
    db.add(project)
    # 첫 번째 빈 슬라이드 자동 생성
    await db.flush()
    slide = Slide(project_id=project.id, order=0)
    db.add(slide)
    await db.commit()
    await db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: UUID, current_user: CurrentUser, db: DB):
    project = await db.get(Project, project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: UUID, body: ProjectUpdate, current_user: CurrentUser, db: DB):
    project = await db.get(Project, project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    project.title = body.title
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: UUID, current_user: CurrentUser, db: DB):
    project = await db.get(Project, project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    await db.delete(project)
    await db.commit()


# ── Slides ────────────────────────────────────────────────


@router.get("/{project_id}/slides", response_model=list[SlideResponse])
async def list_slides(project_id: UUID, current_user: CurrentUser, db: DB):
    await _check_project_owner(project_id, current_user.id, db)
    result = await db.execute(
        select(Slide).where(Slide.project_id == project_id).order_by(Slide.order)
    )
    return result.scalars().all()


@router.post("/{project_id}/slides", response_model=SlideResponse, status_code=status.HTTP_201_CREATED)
async def create_slide(project_id: UUID, body: SlideCreate, current_user: CurrentUser, db: DB):
    await _check_project_owner(project_id, current_user.id, db)
    result = await db.execute(
        select(Slide).where(Slide.project_id == project_id).order_by(Slide.order.desc())
    )
    last = result.scalars().first()
    slide = Slide(project_id=project_id, order=(last.order + 1 if last else 0), title=body.title)
    db.add(slide)
    await db.commit()
    await db.refresh(slide)
    return slide


@router.delete("/{project_id}/slides/{slide_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_slide(project_id: UUID, slide_id: UUID, current_user: CurrentUser, db: DB):
    await _check_project_owner(project_id, current_user.id, db)
    slide = await db.get(Slide, slide_id)
    if not slide or slide.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Slide not found")
    await db.delete(slide)
    await db.commit()


@router.patch("/{project_id}/slides/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_slides(project_id: UUID, body: SlideReorder, current_user: CurrentUser, db: DB):
    await _check_project_owner(project_id, current_user.id, db)
    for i, slide_id in enumerate(body.slide_ids):
        slide = await db.get(Slide, slide_id)
        if slide and slide.project_id == project_id:
            slide.order = i
    await db.commit()


# ── Components ────────────────────────────────────────────


@router.get("/{project_id}/slides/{slide_id}/components", response_model=list[ComponentResponse])
async def list_components(project_id: UUID, slide_id: UUID, current_user: CurrentUser, db: DB):
    await _check_project_owner(project_id, current_user.id, db)
    result = await db.execute(
        select(Component).where(Component.slide_id == slide_id).order_by(Component.order)
    )
    return result.scalars().all()


@router.post(
    "/{project_id}/slides/{slide_id}/components",
    response_model=ComponentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_component(
    project_id: UUID, slide_id: UUID, body: ComponentCreate, current_user: CurrentUser, db: DB
):
    await _check_project_owner(project_id, current_user.id, db)
    comp = Component(
        slide_id=slide_id,
        type=body.type,
        properties=body.properties,
        parent_id=body.parent_id,
        order=body.order,
    )
    db.add(comp)
    await db.commit()
    await db.refresh(comp)
    return comp


@router.patch(
    "/{project_id}/slides/{slide_id}/components/{component_id}",
    response_model=ComponentResponse,
)
async def update_component(
    project_id: UUID, slide_id: UUID, component_id: UUID,
    body: ComponentUpdate, current_user: CurrentUser, db: DB,
):
    await _check_project_owner(project_id, current_user.id, db)
    comp = await db.get(Component, component_id)
    if not comp or comp.slide_id != slide_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    if body.properties is not None:
        comp.properties = body.properties
    if body.order is not None:
        comp.order = body.order
    comp.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(comp)
    return comp


@router.post(
    "/{project_id}/slides/{slide_id}/components/patch",
    response_model=list[ComponentResponse],
)
async def apply_json_patch(
    project_id: UUID, slide_id: UUID,
    body: ComponentPatchRequest, current_user: CurrentUser, db: DB,
):
    """RFC 6902 JSON Patch — op: add/remove/replace/move/copy/test"""
    await _check_project_owner(project_id, current_user.id, db)
    result = await db.execute(
        select(Component).where(Component.slide_id == slide_id)
    )
    components = {str(c.id): c for c in result.scalars().all()}

    for op in body.ops:
        operation = op.get("op")
        path_parts = op.get("path", "").strip("/").split("/")
        comp_id = path_parts[0] if path_parts else None
        comp = components.get(comp_id)
        if not comp:
            continue

        if operation == "replace" and len(path_parts) > 1:
            field = path_parts[1]
            if field == "properties" and len(path_parts) > 2:
                prop_key = path_parts[2]
                comp.properties = {**comp.properties, prop_key: op.get("value")}
            elif field == "order":
                comp.order = op.get("value")
        elif operation == "remove":
            await db.delete(comp)

        comp.updated_at = datetime.now(timezone.utc)

    await db.commit()
    result2 = await db.execute(
        select(Component).where(Component.slide_id == slide_id).order_by(Component.order)
    )
    return result2.scalars().all()


@router.delete(
    "/{project_id}/slides/{slide_id}/components/{component_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_component(
    project_id: UUID, slide_id: UUID, component_id: UUID,
    current_user: CurrentUser, db: DB,
):
    await _check_project_owner(project_id, current_user.id, db)
    comp = await db.get(Component, component_id)
    if not comp or comp.slide_id != slide_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    await db.delete(comp)
    await db.commit()


# ── helpers ───────────────────────────────────────────────


async def _check_project_owner(project_id: UUID, user_id: UUID, db) -> Project:
    project = await db.get(Project, project_id)
    if not project or project.owner_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project
