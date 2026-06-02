from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.deps import CurrentUser, UoW
from app.services import slide_history_service
from app.services.slide_content import apply_patches

router = APIRouter(prefix='/proposals', tags=['proposals'])


class ProposalResponse(BaseModel):
    id: UUID
    slide_id: UUID
    agent_name: str
    command: str
    patches: list
    summary: str
    status: str
    created_at: datetime
    model_config = {'from_attributes': True}


async def _get_proposal_and_verify_ownership(
    proposal_id: UUID, current_user: CurrentUser, uow: UoW
):
    """proposal 조회 + 슬라이드 → 프로젝트 소유권 검증."""
    proposal = await uow.proposals.get(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail='Proposal not found')

    slide = await uow.slides.get(proposal.slide_id)
    if not slide:
        raise HTTPException(status_code=404, detail='Slide not found')

    project = await uow.projects.get(slide.project_id)
    if not project or project.owner_id != current_user.id:
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
    if not project or project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail='Not authorized')
    return await uow.proposals.list_by_slide(slide_id, status=status_filter)


@router.post('/{proposal_id}/approve', status_code=status.HTTP_204_NO_CONTENT)
async def approve_proposal(proposal_id: UUID, current_user: CurrentUser, uow: UoW):
    proposal, slide = await _get_proposal_and_verify_ownership(proposal_id, current_user, uow)

    if proposal.status != 'pending':
        raise HTTPException(status_code=400, detail='Proposal already processed')

    class _PatchTarget:
        def __init__(self, content):
            self.content = content

    target = _PatchTarget(list(slide.content or []))
    apply_patches(target, proposal.patches)

    reason = f'{proposal.agent_name}: {proposal.command[:120]}'
    await slide_history_service.archive_and_apply(uow, proposal.slide_id, target.content, reason, agent_name=proposal.agent_name)
    proposal.status = 'approved'


@router.post('/{proposal_id}/reject', status_code=status.HTTP_204_NO_CONTENT)
async def reject_proposal(proposal_id: UUID, current_user: CurrentUser, uow: UoW):
    proposal, _ = await _get_proposal_and_verify_ownership(proposal_id, current_user, uow)

    if proposal.status != 'pending':
        raise HTTPException(status_code=400, detail='Proposal already processed')

    proposal.status = 'rejected'
