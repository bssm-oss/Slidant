from uuid import UUID

from sqlalchemy import select

from app.models.project import Project
from app.repositories.base import BaseRepository


class ProjectRepository(BaseRepository[Project]):
    model = Project

    async def list_by_owner(self, owner_id: UUID) -> list[Project]:
        result = await self.session.execute(
            select(Project)
            .where(Project.owner_id == owner_id)
            .order_by(Project.updated_at.desc())
        )
        return list(result.scalars().all())

    async def update_yjs_state(self, project_id: UUID, state: bytes) -> None:
        project = await self.get(project_id)
        if project:
            project.yjs_state = state
            self.session.add(project)

    async def get_owned(self, project_id: UUID, owner_id: UUID) -> Project | None:
        result = await self.session.execute(
            select(Project).where(
                Project.id == project_id,
                Project.owner_id == owner_id,
            )
        )
        return result.scalar_one_or_none()
