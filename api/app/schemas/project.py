from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ProjectCreate(BaseModel):
    title: str


class ProjectUpdate(BaseModel):
    title: str


class ProjectResponse(BaseModel):
    id: UUID
    owner_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SlideCreate(BaseModel):
    title: str | None = None


class SlideResponse(BaseModel):
    id: UUID
    project_id: UUID
    order: int
    title: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SlideReorder(BaseModel):
    slide_ids: list[UUID]  # 새 순서대로 나열


class ComponentCreate(BaseModel):
    type: str
    properties: dict = {}
    parent_id: UUID | None = None
    order: int = 0


class ComponentUpdate(BaseModel):
    properties: dict | None = None
    order: int | None = None


class ComponentResponse(BaseModel):
    id: UUID
    slide_id: UUID
    parent_id: UUID | None
    type: str
    properties: dict
    order: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ComponentPatchRequest(BaseModel):
    """RFC 6902 JSON Patch operations"""
    ops: list[dict]  # [{"op": "replace", "path": "/properties/content", "value": "새 텍스트"}]
