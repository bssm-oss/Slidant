from uuid import UUID

from sqlalchemy import select

from app.models.agent_pipeline import AgentPipeline, PipelineStep
from app.repositories.base import BaseRepository


class AgentPipelineRepository(BaseRepository[AgentPipeline]):
    model = AgentPipeline

    async def list_by_project(self, project_id: UUID) -> list[AgentPipeline]:
        result = await self.session.execute(
            select(AgentPipeline)
            .where(AgentPipeline.project_id == project_id)
            .order_by(AgentPipeline.created_at.desc())
        )
        return list(result.scalars().all())


class PipelineStepRepository(BaseRepository[PipelineStep]):
    model = PipelineStep

    async def list_by_pipeline(self, pipeline_id: UUID) -> list[PipelineStep]:
        result = await self.session.execute(
            select(PipelineStep)
            .where(PipelineStep.pipeline_id == pipeline_id)
            .order_by(PipelineStep.step_order.asc())
        )
        return list(result.scalars().all())
