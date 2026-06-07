from datetime import datetime
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class ProjectInvite(SQLModel, table=True):
    __tablename__ = "project_invites"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    project_id: UUID = Field(foreign_key="projects.id", index=True)
    role: str = Field(default="editor", max_length=20)  # editor | viewer
    token: str = Field(unique=True, max_length=64, index=True)
    created_by: UUID = Field(foreign_key="users.id")
    expires_at: datetime | None = Field(default=None, nullable=True)
    max_uses: int | None = Field(default=None, nullable=True)
    use_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
