from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.core.deps import CurrentUser, UoW
from app.models.project import Project
from app.schemas.project import SlideResponse
from app.services import project_service

router = APIRouter(prefix="/share", tags=["share"])


@router.get("/{token}", response_model=dict)
async def get_shared_presentation(token: str, uow: UoW):
    """인증 없이 읽기 전용 프레젠테이션 접근."""
    result = await uow.session.execute(
        select(Project).where(Project.share_token == token)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Shared presentation not found")
    slides = await uow.slides.list_by_project(project.id)
    return {
        "id": str(project.id),
        "title": project.title or "제목 없는 프레젠테이션",
        "slides": [SlideResponse.from_slide(s).model_dump() for s in slides],
    }


@router.post("/{token}/join", response_model=dict)
async def join_shared_project(token: str, current_user: CurrentUser, uow: UoW):
    """공유 링크로 프로젝트 참여 (인증된 유저 → 멤버 등록)."""
    result = await uow.session.execute(
        select(Project).where(Project.share_token == token)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Shared presentation not found")
    await project_service.add_project_member(uow.project_members, project.id, current_user.id, role="editor")
    await uow.commit()
    return {"project_id": str(project.id), "role": "editor"}
