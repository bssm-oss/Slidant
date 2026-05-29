from uuid import UUID

from sqlalchemy import select

from app.models.agent import AgentDefinition, AgentRun, LlmLog
from app.repositories.base import BaseRepository


class AgentDefinitionRepository(BaseRepository[AgentDefinition]):
    model = AgentDefinition

    async def get_system_by_role(self, role: str) -> AgentDefinition | None:
        result = await self.session.execute(
            select(AgentDefinition).where(
                AgentDefinition.role == role,
                AgentDefinition.is_system.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def list_system(self) -> list[AgentDefinition]:
        result = await self.session.execute(
            select(AgentDefinition).where(AgentDefinition.is_system.is_(True))
        )
        return list(result.scalars().all())

    async def list_by_user(self, user_id: UUID) -> list[AgentDefinition]:
        result = await self.session.execute(
            select(AgentDefinition).where(
                AgentDefinition.user_id == user_id,
                AgentDefinition.is_system.is_(False),
            )
        )
        return list(result.scalars().all())


class AgentRunRepository(BaseRepository[AgentRun]):
    model = AgentRun

    async def list_by_project(self, project_id: UUID, limit: int = 50) -> list[AgentRun]:
        result = await self.session.execute(
            select(AgentRun)
            .where(AgentRun.project_id == project_id)
            .order_by(AgentRun.started_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())


class LlmLogRepository(BaseRepository[LlmLog]):
    model = LlmLog
