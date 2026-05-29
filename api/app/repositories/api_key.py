from uuid import UUID

from sqlalchemy import select

from app.models.api_key import ApiKey, ApiKeyUsageLog
from app.repositories.base import BaseRepository


class ApiKeyRepository(BaseRepository[ApiKey]):
    model = ApiKey

    async def get_active(self, user_id: UUID, provider: str = "anthropic") -> ApiKey | None:
        result = await self.session.execute(
            select(ApiKey).where(
                ApiKey.user_id == user_id,
                ApiKey.provider == provider,
                ApiKey.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def list_active(self, user_id: UUID) -> list[ApiKey]:
        result = await self.session.execute(
            select(ApiKey).where(
                ApiKey.user_id == user_id,
                ApiKey.deleted_at.is_(None),
            )
        )
        return list(result.scalars().all())

    async def list_usage(self, api_key_id: UUID, limit: int = 100) -> list[ApiKeyUsageLog]:
        result = await self.session.execute(
            select(ApiKeyUsageLog)
            .where(ApiKeyUsageLog.api_key_id == api_key_id)
            .order_by(ApiKeyUsageLog.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())


class ApiKeyUsageLogRepository(BaseRepository[ApiKeyUsageLog]):
    model = ApiKeyUsageLog
