from uuid import UUID

from sqlalchemy import select

from app.models.component_history import ComponentHistory
from app.repositories.base import BaseRepository


class ComponentHistoryRepository(BaseRepository[ComponentHistory]):
    model = ComponentHistory

    async def list_by_slide(self, slide_id: UUID, limit: int = 100) -> list[ComponentHistory]:
        result = await self.session.execute(
            select(ComponentHistory)
            .where(ComponentHistory.slide_id == slide_id)
            .order_by(ComponentHistory.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def list_by_component(self, slide_id: UUID, component_id: str, limit: int = 50) -> list[ComponentHistory]:
        result = await self.session.execute(
            select(ComponentHistory)
            .where(
                ComponentHistory.slide_id == slide_id,
                ComponentHistory.component_id == component_id,
            )
            .order_by(ComponentHistory.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())
