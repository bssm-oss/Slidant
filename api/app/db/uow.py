from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import AsyncSessionLocal
from app.repositories.agent import AgentDefinitionRepository, AgentRunRepository, LlmLogRepository
from app.repositories.api_key import ApiKeyRepository, ApiKeyUsageLogRepository
from app.repositories.component import ComponentRepository
from app.repositories.project import ProjectRepository
from app.repositories.slide import SlideRepository
from app.repositories.user import UserRepository


class UnitOfWork:
    session: AsyncSession

    # Repositories
    users: UserRepository
    projects: ProjectRepository
    slides: SlideRepository
    components: ComponentRepository
    api_keys: ApiKeyRepository
    api_key_usage_logs: ApiKeyUsageLogRepository
    agent_definitions: AgentDefinitionRepository
    agent_runs: AgentRunRepository
    llm_logs: LlmLogRepository

    async def __aenter__(self) -> "UnitOfWork":
        self.session = AsyncSessionLocal()
        self.users = UserRepository(self.session)
        self.projects = ProjectRepository(self.session)
        self.slides = SlideRepository(self.session)
        self.components = ComponentRepository(self.session)
        self.api_keys = ApiKeyRepository(self.session)
        self.api_key_usage_logs = ApiKeyUsageLogRepository(self.session)
        self.agent_definitions = AgentDefinitionRepository(self.session)
        self.agent_runs = AgentRunRepository(self.session)
        self.llm_logs = LlmLogRepository(self.session)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if exc_type:
            await self.rollback()
        else:
            await self.commit()
        await self.session.close()

    async def commit(self) -> None:
        await self.session.commit()

    async def rollback(self) -> None:
        await self.session.rollback()

    async def flush(self) -> None:
        await self.session.flush()

    async def refresh(self, obj) -> None:
        await self.session.refresh(obj)
