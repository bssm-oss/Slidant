from datetime import datetime
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

    async def get_previous_entry(self, slide_id: UUID, before_dt: datetime) -> SlideHistory | None:
        """주어진 시각 이전에 저장된 가장 최신 SlideHistory 반환."""
        result = await self.session.execute(
            select(SlideHistory)
            .where(
                SlideHistory.slide_id == slide_id,
                SlideHistory.created_at < before_dt,
            )
            .order_by(SlideHistory.created_at.desc(), SlideHistory.id.desc())
            .limit(1)
        )
        return result.scalars().first()
