from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.core.deps import CurrentUser, UoW
from app.models.chat_session import ChatSession
from app.models.user import User
from app.services import project_service

router = APIRouter(prefix="/projects/{project_id}/sessions", tags=["chat-sessions"])


class SessionCreate(BaseModel):
    name: str = "새 세션"


class SessionResponse(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    user_id: UUID | None = None
    user_email: str | None = None
    created_at: str

    model_config = {"from_attributes": True}

    @classmethod
    def from_session(cls, s: ChatSession, user_email: str | None = None) -> "SessionResponse":
        return cls(
            id=s.id, project_id=s.project_id, name=s.name,
            user_id=s.user_id, user_email=user_email, created_at=s.created_at.isoformat(),
        )


async def _require_project_access(project_id: UUID, current_user: CurrentUser, uow: UoW):
    """owner 또는 프로젝트 멤버면 통과."""
    project = await uow.projects.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    is_owner = project.owner_id == current_user.id
    is_member = await project_service.is_project_member(uow.project_members, project_id, current_user.id)
    if not is_owner and not is_member:
        raise HTTPException(status_code=403, detail="Not authorized")
    return project


async def _require_session_owner(session_id: UUID, project_id: UUID, current_user: CurrentUser, uow: UoW):
    """세션 rename/delete — 본인 세션만."""
    session = await uow.chat_sessions.get(session_id)
    if not session or session.project_id != project_id:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id and session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")
    return session


@router.get("", response_model=list[SessionResponse])
async def list_sessions(project_id: UUID, current_user: CurrentUser, uow: UoW):
    await _require_project_access(project_id, current_user, uow)
    sessions = await uow.chat_sessions.list_by_project(project_id)
    user_ids = list({s.user_id for s in sessions if s.user_id})
    email_map: dict[UUID, str] = {}
    if user_ids:
        result = await uow.session.execute(select(User.id, User.email).where(User.id.in_(user_ids)))
        email_map = {row.id: row.email for row in result}
    return [SessionResponse.from_session(s, email_map.get(s.user_id)) for s in sessions]


@router.post("", response_model=SessionResponse, status_code=201)
async def create_session(project_id: UUID, body: SessionCreate, current_user: CurrentUser, uow: UoW):
    await _require_project_access(project_id, current_user, uow)
    session = ChatSession(project_id=project_id, name=body.name, user_id=current_user.id)
    uow.chat_sessions.add(session)
    await uow.flush()
    await uow.refresh(session)
    return SessionResponse.from_session(session)


@router.patch("/{session_id}", response_model=SessionResponse)
async def rename_session(project_id: UUID, session_id: UUID, body: SessionCreate, current_user: CurrentUser, uow: UoW):
    await _require_project_access(project_id, current_user, uow)
    session = await _require_session_owner(session_id, project_id, current_user, uow)
    session.name = body.name
    return SessionResponse.from_session(session)


@router.delete("/{session_id}", status_code=204)
async def delete_session(project_id: UUID, session_id: UUID, current_user: CurrentUser, uow: UoW):
    await _require_project_access(project_id, current_user, uow)
    session = await _require_session_owner(session_id, project_id, current_user, uow)
    await uow.chat_sessions.delete(session)
