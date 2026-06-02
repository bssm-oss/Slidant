from uuid import UUID

from sqlalchemy import select

from app.models.chat import ChatMessage
from app.repositories.base import BaseRepository


class ChatMessageRepository(BaseRepository[ChatMessage]):
    model = ChatMessage

    async def list_by_project(
        self,
        project_id: UUID,
        agent_definition_id: UUID | None = None,
        session_id: UUID | None = None,
        limit: int = 200,
    ) -> list[ChatMessage]:
        q = select(ChatMessage).where(ChatMessage.project_id == project_id)
        if agent_definition_id:
            q = q.where(ChatMessage.agent_definition_id == agent_definition_id)
        if session_id is not None:
            q = q.where(ChatMessage.session_id == session_id)
        q = q.order_by(ChatMessage.created_at.asc()).limit(limit)
        result = await self.session.execute(q)
        return list(result.scalars().all())
