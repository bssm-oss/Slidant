from datetime import datetime
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class ProjectMember(SQLModel, table=True):
    __tablename__ = "project_members"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    project_id: UUID = Field(foreign_key="projects.id", index=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)
    role: str = Field(default="editor", max_length=20)  # owner | editor | viewer
    joined_at: datetime = Field(default_factory=datetime.utcnow)
