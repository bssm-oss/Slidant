from uuid import UUID

from sqlalchemy import select

from app.models.component import Component
from app.repositories.base import BaseRepository


class ComponentRepository(BaseRepository[Component]):
    model = Component

    async def list_by_slide(self, slide_id: UUID) -> list[Component]:
        result = await self.session.execute(
            select(Component)
            .where(Component.slide_id == slide_id)
            .order_by(Component.order)
        )
        return list(result.scalars().all())
