from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/slidant"
    REDIS_URL: str = "redis://localhost:6379"

    SECRET_KEY: str = "dev-secret-key"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    FERNET_KEY: str = ""

    APP_ENV: str = "development"
    MOCK_AGENT: bool = False
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:5173"

    ANTHROPIC_MODEL: str = "claude-sonnet-4-6"
    OPENROUTER_MODEL: str = "deepseek/deepseek-v4-pro"
    OPENROUTER_PLAN_MODEL: str = "deepseek/deepseek-v4-flash"
    AGENT_MAX_RETRIES: int = 2
    AGENT_MAX_TOKENS: int = 4096
    AGENT_MAX_SLIDES: int = 50
    AGENT_BATCH_SIZE: int = 1
    AGENT_BATCH_MAX_TOKENS: int = 12288

    TAVILY_API_KEY: str = ""

    PLAYWRIGHT_SERVICE_URL: str = "http://playwright:3001"
    VISUAL_VALIDATION_ENABLED: bool = False

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
