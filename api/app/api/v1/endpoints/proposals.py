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


@router.post('/{proposal_id}/approve', status_code=status.HTTP_204_NO_CONTENT)
async def approve_proposal(proposal_id: UUID, current_user: CurrentUser, uow: UoW):
    proposal = await uow.proposals.get(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail='Proposal not found')
    if proposal.status != 'pending':
        raise HTTPException(status_code=400, detail='Proposal already processed')

    slide = await uow.slides.get(proposal.slide_id)
    if not slide:
        raise HTTPException(status_code=404, detail='Slide not found')

    class _FakeSlide:
        def __init__(self, content):
            self.content = content

    fake = _FakeSlide(list(slide.content or []))
    apply_patches(fake, proposal.patches)

    reason = f'{proposal.agent_name}: {proposal.command[:120]}'
    await slide_history_service.archive_and_apply(uow, proposal.slide_id, fake.content, reason)
    proposal.status = 'approved'


@router.post('/{proposal_id}/reject', status_code=status.HTTP_204_NO_CONTENT)
async def reject_proposal(proposal_id: UUID, current_user: CurrentUser, uow: UoW):
    proposal = await uow.proposals.get(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail='Proposal not found')
    if proposal.status != 'pending':
        raise HTTPException(status_code=400, detail='Proposal already processed')
    proposal.status = 'rejected'
