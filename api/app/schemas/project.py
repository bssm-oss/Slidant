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
    slide_count: int = 0
    theme: dict | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SlideCreate(BaseModel):
    title: str | None = None


class ComponentResponse(BaseModel):
    id: str
    type: str
    parent_id: str | None
    order: int
    properties: dict
    created_at: str
    updated_at: str


class SlideResponse(BaseModel):
    id: UUID
    project_id: UUID
    order: int
    title: str | None
    components: list[ComponentResponse]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_slide(cls, slide) -> "SlideResponse":
        return cls(
            id=slide.id,
            project_id=slide.project_id,
            order=slide.order,
            title=slide.title,
            components=[ComponentResponse(**c) for c in (slide.content or [])],
            created_at=slide.created_at,
            updated_at=slide.updated_at,
        )


class SlideReorder(BaseModel):
    slide_ids: list[UUID]


class ComponentCreate(BaseModel):
    type: str
    properties: dict = {}
    parent_id: str | None = None
    order: int = 0


class ComponentUpdate(BaseModel):
    properties: dict | None = None
    order: int | None = None


class ComponentPatchRequest(BaseModel):
    """RFC 6902 JSON Patch operations"""
    ops: list[dict]
