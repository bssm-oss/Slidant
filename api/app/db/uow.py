from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import AsyncSessionLocal


class UnitOfWork:
    session: AsyncSession

    async def __aenter__(self) -> "UnitOfWork":
        self.session = AsyncSessionLocal()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if exc_type:
            await self.rollback()
        else:
            await self.commit()
        await self.session.close()

    async def commit(self) -> None:
        await self.session.commit()

    async def rollback(self) -> None:
        await self.session.rollback()
