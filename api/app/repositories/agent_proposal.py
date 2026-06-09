from uuid import UUID

from sqlalchemy import select

from app.models.agent_proposal import AgentProposal
from app.repositories.base import BaseRepository


class AgentProposalRepository(BaseRepository[AgentProposal]):
    model = AgentProposal

    async def list_by_run(self, agent_run_id: UUID) -> list[AgentProposal]:
        stmt = select(AgentProposal).where(AgentProposal.agent_run_id == agent_run_id).order_by(AgentProposal.created_at.asc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_by_slide(self, slide_id: UUID, status: str | None = None) -> list[AgentProposal]:
        stmt = select(AgentProposal).where(AgentProposal.slide_id == slide_id)
        if status:
            stmt = stmt.where(AgentProposal.status == status)
        stmt = stmt.order_by(AgentProposal.created_at.desc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
