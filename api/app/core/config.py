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

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"


settings = Settings()
