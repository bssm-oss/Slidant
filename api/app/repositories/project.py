from uuid import UUID

from sqlalchemy import or_, select

from app.models.project import Project
from app.models.project_member import ProjectMember
from app.repositories.base import BaseRepository


class ProjectRepository(BaseRepository[Project]):
    model = Project

    async def list_accessible(self, user_id: UUID) -> list[tuple[Project, str]]:
        """소유 + 멤버 프로젝트 반환. (project, my_role) 튜플 리스트."""
        # 소유 프로젝트
        owned_q = await self.session.execute(
            select(Project).where(Project.owner_id == user_id).order_by(Project.updated_at.desc())
        )
        owned = owned_q.scalars().all()

        # 멤버 프로젝트
        member_q = await self.session.execute(
            select(Project, ProjectMember.role)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(ProjectMember.user_id == user_id)
            .order_by(Project.updated_at.desc())
        )
        member_rows = member_q.all()

        owned_ids = {p.id for p in owned}
        result: list[tuple[Project, str]] = [(p, "owner") for p in owned]
        for project, role in member_rows:
            if project.id not in owned_ids:
                result.append((project, role))
        return result

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

    async def update_search_cache(self, project_id: UUID, summary: str, queries: list) -> None:
        project = await self.get(project_id)
        if project:
            project.search_summary = summary
            project.search_queries = queries
            self.session.add(project)

    async def get_owned(self, project_id: UUID, owner_id: UUID) -> Project | None:
        result = await self.session.execute(
            select(Project).where(
                Project.id == project_id,
                Project.owner_id == owner_id,
            )
        )
        return result.scalar_one_or_none()
