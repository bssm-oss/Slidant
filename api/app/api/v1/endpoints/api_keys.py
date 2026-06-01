from uuid import UUID

from fastapi import APIRouter, status

from app.core.deps import CurrentUser, UoW
from app.schemas.api_key import ApiKeyCreate, ApiKeyResponse, ApiKeyUsageResponse
from app.services import api_key_service

router = APIRouter(prefix="/user/api-keys", tags=["api-keys"])


@router.get("", response_model=list[ApiKeyResponse])
async def list_api_keys(current_user: CurrentUser, uow: UoW):
    return await api_key_service.list_api_keys(uow.api_keys, current_user.id)


@router.post("", response_model=ApiKeyResponse, status_code=status.HTTP_201_CREATED)
async def register_api_key(body: ApiKeyCreate, current_user: CurrentUser, uow: UoW):
    return await api_key_service.register_api_key(uow.api_keys, current_user.id, body.api_key, body.provider)


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_key(key_id: UUID, current_user: CurrentUser, uow: UoW):
    await api_key_service.delete_api_key(uow.api_keys, current_user.id, key_id)


@router.get("/{key_id}/usage", response_model=list[ApiKeyUsageResponse])
async def get_usage(key_id: UUID, current_user: CurrentUser, uow: UoW):
    return await api_key_service.get_usage(uow.api_keys, current_user.id, key_id)
