from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.v1.endpoints.ws import manager as ws_manager
from app.core.deps import CurrentUser, UoW
from app.services import project_service, slide_history_service
from app.services.slide_content import apply_patches

router = APIRouter(prefix='/proposals', tags=['proposals'])


async def _notify_proposal_resolved(project_id, slide_id, proposal_id, status: str) -> None:
    """다른 커넥션에 proposal 처리 결과 알림 — pending 목록 정리 + (승인 시) 슬라이드 재조회 트리거."""
    await ws_manager.broadcast_json(str(project_id), {
        'type': 'proposal_resolved',
        'proposal_id': str(proposal_id),
        'slide_id': str(slide_id),
        'status': status,
    })


class ProposalResponse(BaseModel):
    id: UUID
    slide_id: UUID
    agent_name: str
    command: str
    patches: list
    summary: str
    html_content: str | None = None
    status: str
    created_at: datetime
    model_config = {'from_attributes': True}


class ApproveBody(BaseModel):
    accepted_ids: list[str] | None = None  # None → 전체 승인, list → 선택 컴포넌트만 승인
    partial: bool = False


async def _get_proposal_and_verify_edit_permission(
    proposal_id: UUID, current_user: CurrentUser, uow: UoW
):
    proposal = await uow.proposals.get(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail='Proposal not found')

    slide = await uow.slides.get(proposal.slide_id)
    if not slide:
        raise HTTPException(status_code=404, detail='Slide not found')

    project = await uow.projects.get(slide.project_id)
    if not project:
        raise HTTPException(status_code=404, detail='Project not found')

    is_owner = project.owner_id == current_user.id
    if not is_owner:
        member = await uow.project_members.get_member(project.id, current_user.id)
        if not member or member.role not in ('owner', 'editor'):
            raise HTTPException(status_code=403, detail='Not authorized')

    return proposal, slide


@router.get('/by-slide/{slide_id}', response_model=list[ProposalResponse])
async def list_proposals_by_slide(
    slide_id: UUID, current_user: CurrentUser, uow: UoW, status_filter: str | None = None
):
    slide = await uow.slides.get(slide_id)
    if not slide:
        raise HTTPException(status_code=404, detail='Slide not found')
    project = await uow.projects.get(slide.project_id)
    if not project:
        raise HTTPException(status_code=404, detail='Project not found')
    is_owner = project.owner_id == current_user.id
    is_member = await project_service.is_project_member(uow.project_members, project.id, current_user.id)
    if not is_owner and not is_member:
        raise HTTPException(status_code=403, detail='Not authorized')
    return await uow.proposals.list_by_slide(slide_id, status=status_filter)


@router.post('/{proposal_id}/approve', status_code=status.HTTP_204_NO_CONTENT)
async def approve_proposal(proposal_id: UUID, body: ApproveBody, current_user: CurrentUser, uow: UoW):
    proposal, slide = await _get_proposal_and_verify_edit_permission(proposal_id, current_user, uow)

    if proposal.status != 'pending':
        raise HTTPException(status_code=400, detail='Proposal already processed')

    reason = f'{proposal.agent_name}: {proposal.command[:120]}'

    if proposal.html_content:
        # HTML 모드: 제안된 변경분을 "현재" 슬라이드에 병합
        # (proposal.html_content는 생성 시점 스냅샷 그대로 — 그 사이 다른 승인/직접편집으로
        #  슬라이드가 더 진행됐을 수 있어 그대로 덮어쓰면 그 변경분이 유실됨.
        #  항상 최신 슬라이드 위에, 이 제안이 "실제로 의도한" 컴포넌트만 얹는다)
        from app.core.domain.html_slide import merge_component_changes, changed_component_ids
        if body.accepted_ids is None:
            # 전체 승인 → 제안 생성 시점 기준선(base_html_content) 대비 이 제안이
            # 실제로 바꾼 컴포넌트만 추려 최신 상태에 병합 — 기준선 없는 레거시 제안은
            # 현재 상태 대비 diff로 대체 (완벽하진 않지만 wholesale 교체보단 안전)
            base = proposal.base_html_content
            if base is None:
                base = slide.html_content or ""
            accepted_ids = list(changed_component_ids(base, proposal.html_content))
        else:
            # 선택 승인 → 지정된 컴포넌트만 병합
            accepted_ids = body.accepted_ids
        final_html = merge_component_changes(
            slide.html_content or "",
            proposal.html_content,
            accepted_ids,
        )
        await slide_history_service.archive_and_apply(
            uow, proposal.slide_id, list(slide.content or []),
            reason, agent_name=proposal.agent_name, html_content=final_html,
        )
    else:
        # JSON patch 모드 (레거시)
        class _PatchTarget:
            def __init__(self, content):
                self.content = content
        target = _PatchTarget(list(slide.content or []))
        apply_patches(target, proposal.patches)
        await slide_history_service.archive_and_apply(
            uow, proposal.slide_id, target.content, reason, agent_name=proposal.agent_name,
        )

    if not body.partial:
        proposal.status = 'approved'
    uow.session.add(proposal)
    await uow.commit()  # broadcast 전에 먼저 커밋 — 다른 커넥션 재조회 시 최신 데이터 보장

    if not body.partial:
        await _notify_proposal_resolved(slide.project_id, proposal.slide_id, proposal.id, 'approved')


@router.post('/{proposal_id}/reject', status_code=status.HTTP_204_NO_CONTENT)
async def reject_proposal(proposal_id: UUID, current_user: CurrentUser, uow: UoW):
    proposal, slide = await _get_proposal_and_verify_edit_permission(proposal_id, current_user, uow)

    if proposal.status != 'pending':
        raise HTTPException(status_code=400, detail='Proposal already processed')

    proposal.status = 'rejected'
    uow.session.add(proposal)
    await uow.commit()

    await _notify_proposal_resolved(slide.project_id, proposal.slide_id, proposal.id, 'rejected')
