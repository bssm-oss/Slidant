from uuid import UUID

from sqlalchemy import select

from app.models.project_invite import ProjectInvite
from app.repositories.base import BaseRepository


class ProjectInviteRepository(BaseRepository[ProjectInvite]):
    model = ProjectInvite

    async def get_by_token(self, token: str) -> ProjectInvite | None:
        result = await self.session.execute(
            select(ProjectInvite).where(ProjectInvite.token == token)
        )
        return result.scalar_one_or_none()

    async def list_by_project(self, project_id: UUID) -> list[ProjectInvite]:
        result = await self.session.execute(
            select(ProjectInvite)
            .where(ProjectInvite.project_id == project_id)
            .order_by(ProjectInvite.created_at.desc())
        )
        return list(result.scalars().all())
