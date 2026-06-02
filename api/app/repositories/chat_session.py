from uuid import UUID

from sqlalchemy import select

from app.models.chat_session import ChatSession
from app.repositories.base import BaseRepository


class ChatSessionRepository(BaseRepository[ChatSession]):
    model = ChatSession

    async def list_by_project(self, project_id: UUID) -> list[ChatSession]:
        result = await self.session.execute(
            select(ChatSession)
            .where(ChatSession.project_id == project_id)
            .order_by(ChatSession.created_at.asc())
        )
        return list(result.scalars().all())
