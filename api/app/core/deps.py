from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, HTTPException, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.uow import UnitOfWork
from app.models.user import User
from app.repositories.user import UserRepository

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


async def get_current_user_ws(websocket: WebSocket, session: AsyncSession) -> User | None:
    """WebSocket 핸드셰이크에서 토큰 추출 — Authorization 헤더 또는 token 쿼리 파라미터."""
    token: str | None = None

    auth_header = websocket.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:]
    else:
        token = websocket.query_params.get("token")

    if not token:
        return None
    try:
        payload = decode_access_token(token)
        user_id: str = payload.get("sub")
    except JWTError:
        return None

    repo = UserRepository(session)
    user = await repo.get(user_id)
    if not user or getattr(user, "deleted_at", None):
        return None
    return user
