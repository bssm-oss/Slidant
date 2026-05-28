from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DB
from app.core.security import decrypt_api_key, encrypt_api_key
from app.models.api_key import ApiKey, ApiKeyUsageLog
from app.schemas.api_key import ApiKeyCreate, ApiKeyResponse, ApiKeyUsageResponse

router = APIRouter(prefix="/user/api-keys", tags=["api-keys"])


@router.get("", response_model=list[ApiKeyResponse])
async def list_api_keys(current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(ApiKey)
        .where(ApiKey.user_id == current_user.id, ApiKey.deleted_at.is_(None))
    )
    return result.scalars().all()


@router.post("", response_model=ApiKeyResponse, status_code=status.HTTP_201_CREATED)
async def register_api_key(body: ApiKeyCreate, current_user: CurrentUser, db: DB):
    # 같은 provider key 이미 있으면 소프트 삭제 후 교체
    existing = await db.execute(
        select(ApiKey).where(
            ApiKey.user_id == current_user.id,
            ApiKey.provider == body.provider,
            ApiKey.deleted_at.is_(None),
        )
    )
    for old in existing.scalars().all():
        old.deleted_at = datetime.now(timezone.utc)

    api_key = ApiKey(
        user_id=current_user.id,
        provider=body.provider,
        encrypted_key=encrypt_api_key(body.api_key),
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)
    return api_key


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_key(key_id: UUID, current_user: CurrentUser, db: DB):
    api_key = await db.get(ApiKey, key_id)
    if not api_key or api_key.user_id != current_user.id or api_key.deleted_at:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")
    api_key.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.get("/{key_id}/usage", response_model=list[ApiKeyUsageResponse])
async def get_usage(key_id: UUID, current_user: CurrentUser, db: DB):
    api_key = await db.get(ApiKey, key_id)
    if not api_key or api_key.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")
    result = await db.execute(
        select(ApiKeyUsageLog)
        .where(ApiKeyUsageLog.api_key_id == key_id)
        .order_by(ApiKeyUsageLog.created_at.desc())
        .limit(100)
    )
    return result.scalars().all()
