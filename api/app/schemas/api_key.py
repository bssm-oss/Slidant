from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ApiKeyCreate(BaseModel):
    api_key: str  # plaintext — 저장 전 암호화됨
    provider: str = "anthropic"


class ApiKeyResponse(BaseModel):
    id: UUID
    provider: str
    created_at: datetime
    # encrypted_key, plaintext 절대 포함 안 함

    model_config = {"from_attributes": True}


class ApiKeyUsageResponse(BaseModel):
    id: UUID
    model: str
    tokens_input: int
    tokens_output: int
    created_at: datetime

    model_config = {"from_attributes": True}
