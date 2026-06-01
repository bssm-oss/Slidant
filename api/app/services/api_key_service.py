from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status

from app.core.security import encrypt_api_key
from app.models.api_key import ApiKey, ApiKeyUsageLog
from app.repositories.api_key import ApiKeyRepository


async def register_api_key(api_key_repo: ApiKeyRepository, user_id: UUID, api_key: str, provider: str) -> ApiKey:
    # 같은 provider 기존 키 소프트 삭제
    existing = await api_key_repo.get_active(user_id, provider)
    if existing:
        existing.deleted_at = datetime.utcnow()

    new_key = ApiKey(user_id=user_id, provider=provider, encrypted_key=encrypt_api_key(api_key))
    api_key_repo.add(new_key)
    await api_key_repo.session.flush()
    await api_key_repo.session.refresh(new_key)
    return new_key


async def delete_api_key(api_key_repo: ApiKeyRepository, user_id: UUID, key_id: UUID) -> None:
    key = await api_key_repo.get(key_id)
    if not key or key.user_id != user_id or key.deleted_at:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")
    key.deleted_at = datetime.utcnow()


async def list_api_keys(api_key_repo: ApiKeyRepository, user_id: UUID) -> list[ApiKey]:
    return await api_key_repo.list_active(user_id)


async def get_usage(api_key_repo: ApiKeyRepository, user_id: UUID, key_id: UUID) -> list[ApiKeyUsageLog]:
    key = await api_key_repo.get(key_id)
    if not key or key.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")
    return await api_key_repo.list_usage(key_id)
