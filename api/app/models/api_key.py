from datetime import datetime
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class ApiKey(SQLModel, table=True):
    __tablename__ = "api_keys"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)
    provider: str = Field(default="anthropic", max_length=50)
    encrypted_key: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: datetime | None = None


class ApiKeyUsageLog(SQLModel, table=True):
    __tablename__ = "api_key_usage_logs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    api_key_id: UUID = Field(foreign_key="api_keys.id", index=True)
    tokens_input: int = 0
    tokens_output: int = 0
    model: str = Field(max_length=100)
    created_at: datetime = Field(default_factory=datetime.utcnow)
