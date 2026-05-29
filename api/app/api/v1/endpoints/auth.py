from fastapi import APIRouter, status

from app.core.deps import UoW
from app.schemas.auth import LoginRequest, SignupRequest, TokenResponse
from app.schemas.user import UserResponse
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def signup(body: SignupRequest, uow: UoW):
    return await auth_service.register_user(uow, body.email, body.password)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, uow: UoW):
    token = await auth_service.authenticate_user(uow, body.email, body.password)
    return TokenResponse(access_token=token)
