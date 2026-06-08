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

    async def get_next_entry(self, slide_id: UUID, after_dt: datetime) -> SlideHistory | None:
        """주어진 시각 이후에 저장된 가장 오래된 SlideHistory 반환."""
        result = await self.session.execute(
            select(SlideHistory)
            .where(
                SlideHistory.slide_id == slide_id,
                SlideHistory.created_at > after_dt,
            )
            .order_by(SlideHistory.created_at.asc(), SlideHistory.id.asc())
            .limit(1)
        )
        return result.scalars().first()

    async def list_by_slides_in_timerange(
        self, slide_ids: list[UUID], start: datetime, end: datetime,
    ) -> list[SlideHistory]:
        """여러 슬라이드에 대해 시간 범위 내 SlideHistory 반환."""
        if not slide_ids:
            return []
        result = await self.session.execute(
            select(SlideHistory)
            .where(
                SlideHistory.slide_id.in_(slide_ids),
                SlideHistory.created_at >= start,
                SlideHistory.created_at <= end,
            )
            .order_by(SlideHistory.created_at.asc())
        )
        return list(result.scalars().all())
