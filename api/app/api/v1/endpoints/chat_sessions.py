from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import CurrentUser, UoW
from app.models.chat_session import ChatSession

router = APIRouter(prefix="/projects/{project_id}/sessions", tags=["chat-sessions"])


class SessionCreate(BaseModel):
    name: str = "새 세션"


class SessionResponse(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    created_at: str

    model_config = {"from_attributes": True}

    @classmethod
    def from_session(cls, s: ChatSession) -> "SessionResponse":
        return cls(id=s.id, project_id=s.project_id, name=s.name, created_at=s.created_at.isoformat())


@router.get("", response_model=list[SessionResponse])
async def list_sessions(project_id: UUID, current_user: CurrentUser, uow: UoW):
    project = await uow.projects.get(project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    sessions = await uow.chat_sessions.list_by_project(project_id)
    return [SessionResponse.from_session(s) for s in sessions]


@router.post("", response_model=SessionResponse, status_code=201)
async def create_session(project_id: UUID, body: SessionCreate, current_user: CurrentUser, uow: UoW):
    project = await uow.projects.get(project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    session = ChatSession(project_id=project_id, name=body.name)
    uow.chat_sessions.add(session)
    await uow.flush()
    await uow.refresh(session)
    return SessionResponse.from_session(session)


@router.patch("/{session_id}", response_model=SessionResponse)
async def rename_session(project_id: UUID, session_id: UUID, body: SessionCreate, current_user: CurrentUser, uow: UoW):
    project = await uow.projects.get(project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    session = await uow.chat_sessions.get(session_id)
    if not session or session.project_id != project_id:
        raise HTTPException(status_code=404, detail="Session not found")
    session.name = body.name
    return SessionResponse.from_session(session)


@router.delete("/{session_id}", status_code=204)
async def delete_session(project_id: UUID, session_id: UUID, current_user: CurrentUser, uow: UoW):
    project = await uow.projects.get(project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    session = await uow.chat_sessions.get(session_id)
    if not session or session.project_id != project_id:
        raise HTTPException(status_code=404, detail="Session not found")
    await uow.chat_sessions.delete(session)
