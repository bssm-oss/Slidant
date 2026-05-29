from fastapi import HTTPException, status

from app.core.security import create_access_token, hash_password, verify_password
from app.db.uow import UnitOfWork
from app.models.user import User


async def register_user(uow: UnitOfWork, email: str, password: str) -> User:
    existing = await uow.users.get_by_email(email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(email=email, hashed_password=hash_password(password))
    uow.users.add(user)
    await uow.flush()
    await uow.refresh(user)
    return user


async def authenticate_user(uow: UnitOfWork, email: str, password: str) -> str:
    user = await uow.users.get_by_email(email)
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if user.deleted_at:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deleted")
    return create_access_token(str(user.id))
