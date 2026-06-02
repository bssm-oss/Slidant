from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import AsyncSessionLocal
from app.repositories.agent import AgentDefinitionRepository, AgentRunRepository, LlmLogRepository
from app.repositories.agent_pipeline import AgentPipelineRepository, PipelineStepRepository
from app.repositories.agent_proposal import AgentProposalRepository
from app.repositories.api_key import ApiKeyRepository, ApiKeyUsageLogRepository
from app.repositories.chat import ChatMessageRepository
from app.repositories.chat_session import ChatSessionRepository
from app.repositories.component_history import ComponentHistoryRepository
from app.repositories.project import ProjectRepository
from app.repositories.slide import SlideRepository
from app.repositories.slide_history import SlideHistoryRepository
from app.repositories.user import UserRepository
from app.repositories.version import VersionRepository


class UnitOfWork:
    session: AsyncSession

    # Repositories
    users: UserRepository
    projects: ProjectRepository
    slides: SlideRepository
    slide_history: SlideHistoryRepository
    component_history: ComponentHistoryRepository
    proposals: AgentProposalRepository
    api_keys: ApiKeyRepository
    api_key_usage_logs: ApiKeyUsageLogRepository
    agent_definitions: AgentDefinitionRepository
    agent_runs: AgentRunRepository
    llm_logs: LlmLogRepository
    chat_sessions: ChatSessionRepository
    chat_messages: ChatMessageRepository
    versions: VersionRepository
    pipelines: AgentPipelineRepository
    pipeline_steps: PipelineStepRepository

    async def __aenter__(self) -> "UnitOfWork":
        self.session = AsyncSessionLocal()
        self.users = UserRepository(self.session)
        self.projects = ProjectRepository(self.session)
        self.slides = SlideRepository(self.session)
        self.slide_history = SlideHistoryRepository(self.session)
        self.component_history = ComponentHistoryRepository(self.session)
        self.proposals = AgentProposalRepository(self.session)
        self.api_keys = ApiKeyRepository(self.session)
        self.api_key_usage_logs = ApiKeyUsageLogRepository(self.session)
        self.agent_definitions = AgentDefinitionRepository(self.session)
        self.agent_runs = AgentRunRepository(self.session)
        self.llm_logs = LlmLogRepository(self.session)
        self.chat_sessions = ChatSessionRepository(self.session)
        self.chat_messages = ChatMessageRepository(self.session)
        self.versions = VersionRepository(self.session)
        self.pipelines = AgentPipelineRepository(self.session)
        self.pipeline_steps = PipelineStepRepository(self.session)
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
