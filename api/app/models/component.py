from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field


class ComponentDoc(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    type: str
    parent_id: str | None = None
    order: int = 0
    properties: dict = Field(default_factory=dict)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
