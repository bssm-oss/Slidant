from uuid import UUID

from sqlalchemy import select

from app.models.slide import Slide
from app.repositories.base import BaseRepository


class SlideRepository(BaseRepository[Slide]):
    model = Slide

    async def list_by_project(self, project_id: UUID) -> list[Slide]:
        result = await self.session.execute(
            select(Slide).where(Slide.project_id == project_id).order_by(Slide.order)
        )
        return list(result.scalars().all())

    async def get_last_order(self, project_id: UUID) -> int:
        result = await self.session.execute(
            select(Slide).where(Slide.project_id == project_id).order_by(Slide.order.desc())
        )
        last = result.scalars().first()
        return last.order + 1 if last else 0
