from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr


class UserResponse(BaseModel):
    id: UUID
    email: EmailStr
    created_at: datetime

    model_config = {"from_attributes": True}
