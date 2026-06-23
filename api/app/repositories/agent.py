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
        """Library agents: user-owned, not project-scoped."""
        result = await self.session.execute(
            select(AgentDefinition).where(
                AgentDefinition.user_id == user_id,
                AgentDefinition.is_system.is_(False),
                AgentDefinition.project_id.is_(None),
            )
        )
        return list(result.scalars().all())

    async def list_by_project(self, user_id: UUID, project_id: UUID) -> list[AgentDefinition]:
        """PPT에 추가된 모든 에이전트 반환 — 누가 가져왔든 프로젝트 멤버 전체 공유."""
        result = await self.session.execute(
            select(AgentDefinition).where(
                AgentDefinition.project_id == project_id,
                AgentDefinition.is_system.is_(False),
            )
        )
        return list(result.scalars().all())


class AgentRunRepository(BaseRepository[AgentRun]):
    model = AgentRun

    async def list_running_by_project(self, project_id: UUID) -> list[AgentRun]:
        from uuid import UUID as _UUID
        from datetime import datetime, timedelta, timezone
        stale_cutoff = datetime.now(timezone.utc) - timedelta(hours=2)
        result = await self.session.execute(
            select(AgentRun)
            .where(AgentRun.project_id == _UUID(str(project_id)),
                   AgentRun.status == "running",
                   AgentRun.started_at >= stale_cutoff)
            .order_by(AgentRun.started_at.desc())
        )
        return list(result.scalars().all())

    async def list_by_project(self, project_id: UUID, limit: int = 50) -> list[tuple[AgentRun, str | None]]:
        from app.models.user import User
        result = await self.session.execute(
            select(AgentRun, User.email)
            .outerjoin(User, AgentRun.user_id == User.id)
            .where(AgentRun.project_id == project_id)
            .order_by(AgentRun.started_at.desc())
            .limit(limit)
        )
        return list(result.all())


class LlmLogRepository(BaseRepository[LlmLog]):
    model = LlmLog
