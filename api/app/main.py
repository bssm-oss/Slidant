from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router
from app.core.config import settings
from app.core.logging import LoggingMiddleware, setup_logging
from app.middleware.sanitize import SanitizeMiddleware


async def _seed_dev_user() -> None:
    from sqlalchemy import select
    from app.db.base import AsyncSessionLocal
    from app.models.user import User
    from app.core.security import hash_password

    email = "dev@slidant.com"
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == email))
        if result.scalar_one_or_none():
            return
        session.add(User(email=email, hashed_password=hash_password("pass1234")))
        await session.commit()


setup_logging(is_production=settings.is_production)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _seed_dev_user()
    yield


app = FastAPI(title="Slidant API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(LoggingMiddleware)
app.add_middleware(SanitizeMiddleware)

app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok"}
