from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = Field(default="development")
    api_host: str = Field(default="0.0.0.0")
    api_port: int = Field(default=8000)

    # Runtime DB URL — Supavisor session mode (port 5432 on Supabase).
    # Session mode is correct for long-running FastAPI workers because the
    # SQLAlchemy asyncpg dialect calls prepare() on every query, which
    # Supavisor transaction mode (port 6543) does not support.
    database_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/postgres",
        description="Postgres URL for SQLAlchemy runtime (asyncpg driver).",
    )
    # Migration DB URL — also Supavisor session mode (port 5432).
    # Kept as a separate knob so production can point it at a direct
    # connection if preferred; migrations run just as well on either.
    database_url_direct: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/postgres",
        description="Postgres URL for Alembic migrations (session mode).",
    )

    supabase_url: str = Field(default="")
    # New Supabase API keys (2025+). Legacy anon/service_role are being phased out.
    supabase_publishable_key: str = Field(default="")  # frontend-safe, sb_publishable_...
    supabase_secret_key: str = Field(default="")  # backend only, sb_secret_...
    # JWKS URL for asymmetric JWT verification (replaces static SUPABASE_JWT_SECRET).
    supabase_jwks_url: str = Field(default="")

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])


@lru_cache
def get_settings() -> Settings:
    return Settings()
