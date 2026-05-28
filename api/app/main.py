from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router
from app.middleware.sanitize import SanitizeMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="Slidant API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:3002", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SanitizeMiddleware)

app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok"}
