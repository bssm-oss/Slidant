from uuid import UUID

from sqlalchemy import select

from app.models.version import Version
from app.repositories.base import BaseRepository


class VersionRepository(BaseRepository[Version]):
    model = Version

    async def list_by_slide(self, slide_id: UUID, limit: int = 50) -> list[Version]:
        result = await self.session.execute(
            select(Version)
            .where(Version.slide_id == slide_id)
            .order_by(Version.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())
