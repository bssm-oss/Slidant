from uuid import UUID

from sqlalchemy import select

from app.models.project_member import ProjectMember
from app.repositories.base import BaseRepository


class ProjectMemberRepository(BaseRepository[ProjectMember]):
    model = ProjectMember

    async def list_by_project(self, project_id: UUID) -> list[ProjectMember]:
        result = await self.session.execute(
            select(ProjectMember)
            .where(ProjectMember.project_id == project_id)
            .order_by(ProjectMember.joined_at.asc())
        )
        return list(result.scalars().all())

    async def get_member(self, project_id: UUID, user_id: UUID) -> ProjectMember | None:
        result = await self.session.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def is_member(self, project_id: UUID, user_id: UUID) -> bool:
        return await self.get_member(project_id, user_id) is not None
