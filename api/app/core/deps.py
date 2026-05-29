from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError

from app.core.security import decode_access_token
from app.db.uow import UnitOfWork
from app.models.user import User

bearer = HTTPBearer()


async def get_uow() -> AsyncGenerator[UnitOfWork, None]:
    async with UnitOfWork() as uow:
        yield uow


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer)],
    uow: Annotated[UnitOfWork, Depends(get_uow)],
) -> User:
    try:
        payload = decode_access_token(credentials.credentials)
        user_id: str = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = await uow.users.get(user_id)
    if not user or user.deleted_at:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


UoW = Annotated[UnitOfWork, Depends(get_uow)]
CurrentUser = Annotated[User, Depends(get_current_user)]
