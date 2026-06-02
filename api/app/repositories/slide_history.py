from uuid import UUID

from sqlalchemy import select

from app.models.slide_history import SlideHistory
from app.repositories.base import BaseRepository


class SlideHistoryRepository(BaseRepository[SlideHistory]):
    model = SlideHistory

    async def list_by_slide(self, slide_id: UUID, limit: int = 50) -> list[SlideHistory]:
        result = await self.session.execute(
            select(SlideHistory)
            .where(SlideHistory.slide_id == slide_id)
            .order_by(SlideHistory.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())
