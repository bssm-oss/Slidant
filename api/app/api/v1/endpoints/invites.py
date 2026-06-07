"""초대 링크 생성 및 수락."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import CurrentUser, UoW
from app.models.project_invite import ProjectInvite
from app.services import project_service

router = APIRouter(prefix="/invites", tags=["invites"])


class CreateInviteBody(BaseModel):
    role: str = "editor"  # editor | viewer
    expires_in_hours: int | None = None  # None = 만료 없음
    max_uses: int | None = None


class InviteResponse(BaseModel):
    token: str
    role: str
    project_id: UUID
    invite_url: str
    expires_at: datetime | None
    max_uses: int | None
    use_count: int


class InviteInfoResponse(BaseModel):
    token: str
    role: str
    project_id: UUID
    project_title: str
    is_valid: bool
    reason: str | None = None  # 무효 사유


@router.post("/projects/{project_id}/invites", response_model=InviteResponse)
async def create_invite(
    project_id: UUID,
    body: CreateInviteBody,
    current_user: CurrentUser,
    uow: UoW,
) -> InviteResponse:
    """초대 링크 생성 (프로젝트 소유자 전용)."""
    project = await uow.projects.get(project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="프로젝트 소유자만 초대 링크를 생성할 수 있습니다.")

    if body.role not in ("editor", "viewer"):
        raise HTTPException(status_code=400, detail="role은 editor 또는 viewer여야 합니다.")

    expires_at = (
        datetime.utcnow() + timedelta(hours=body.expires_in_hours)
        if body.expires_in_hours
        else None
    )

    invite = ProjectInvite(
        project_id=project_id,
        role=body.role,
        token=secrets.token_urlsafe(32),
        created_by=current_user.id,
        expires_at=expires_at,
        max_uses=body.max_uses,
    )
    uow.session.add(invite)
    await uow.flush()
    await uow.refresh(invite)

    return InviteResponse(
        token=invite.token,
        role=invite.role,
        project_id=invite.project_id,
        invite_url=f"/invite/{invite.token}",
        expires_at=invite.expires_at,
        max_uses=invite.max_uses,
        use_count=invite.use_count,
    )


@router.get("/{token}/info", response_model=InviteInfoResponse)
async def get_invite_info(token: str, uow: UoW) -> InviteInfoResponse:
    """초대 링크 정보 조회 (인증 불필요, 수락 전 미리보기)."""
    invite = await uow.project_invites.get_by_token(token)
    if not invite:
        raise HTTPException(status_code=404, detail="초대 링크를 찾을 수 없습니다.")

    project = await uow.projects.get(invite.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    # 유효성 검사
    if invite.expires_at and datetime.utcnow() > invite.expires_at:
        return InviteInfoResponse(
            token=token, role=invite.role, project_id=invite.project_id,
            project_title=project.title, is_valid=False, reason="만료된 초대 링크입니다.",
        )
    if invite.max_uses is not None and invite.use_count >= invite.max_uses:
        return InviteInfoResponse(
            token=token, role=invite.role, project_id=invite.project_id,
            project_title=project.title, is_valid=False, reason="사용 횟수가 초과된 초대 링크입니다.",
        )

    return InviteInfoResponse(
        token=token, role=invite.role, project_id=invite.project_id,
        project_title=project.title, is_valid=True,
    )


@router.post("/{token}/accept", response_model=dict)
async def accept_invite(token: str, current_user: CurrentUser, uow: UoW) -> dict:
    """초대 수락 → project_members에 등록."""
    invite = await uow.project_invites.get_by_token(token)
    if not invite:
        raise HTTPException(status_code=404, detail="초대 링크를 찾을 수 없습니다.")

    project = await uow.projects.get(invite.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    # 소유자 본인은 그냥 리다이렉트
    if project.owner_id == current_user.id:
        return {"project_id": str(project.id), "role": "owner", "already_member": True}

    # 유효성 검사
    if invite.expires_at and datetime.utcnow() > invite.expires_at:
        raise HTTPException(status_code=410, detail="만료된 초대 링크입니다.")
    if invite.max_uses is not None and invite.use_count >= invite.max_uses:
        raise HTTPException(status_code=410, detail="사용 횟수가 초과된 초대 링크입니다.")

    # 이미 멤버면 역할만 업데이트
    existing = await uow.project_members.get_member(invite.project_id, current_user.id)
    if existing:
        if existing.role != invite.role:
            existing.role = invite.role
            uow.session.add(existing)
        return {"project_id": str(project.id), "role": existing.role, "already_member": True}

    # 신규 멤버 등록
    await project_service.add_project_member(
        uow.project_members, invite.project_id, current_user.id, role=invite.role
    )

    # 사용 횟수 증가
    invite.use_count += 1
    uow.session.add(invite)

    return {"project_id": str(project.id), "role": invite.role, "already_member": False}
