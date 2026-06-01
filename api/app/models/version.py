from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class Version(SQLModel, table=True):
    __tablename__ = "versions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    slide_id: UUID = Field(foreign_key="slides.id", index=True)
    message: str = Field(default="", max_length=500)
    snapshot: dict = Field(default_factory=dict, sa_column=Column(JSONB))  # 슬라이드 컴포넌트 전체 스냅샷
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ComponentPatch(SQLModel, table=True):
    __tablename__ = "component_patches"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    version_id: UUID = Field(foreign_key="versions.id", index=True)
    component_id: UUID = Field(foreign_key="components.id", index=True)
    patch_ops: list = Field(default_factory=list, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=datetime.utcnow)
