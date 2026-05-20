from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
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

    # Runtime DB URL — defaults to a local SQLite file via aiosqlite for
    # zero-config dev. The path is relative to the process's CWD; running
    # `make dev-api` from the repo root puts the DB at `apps/api/tcsh.db`.
    #
    # Production can override via env var to point at any SQLAlchemy-supported
    # async URL (e.g. `postgresql+asyncpg://…` if the deployment swaps back
    # to Postgres). The two URL knobs below are kept separate so migrations
    # can target a different host than the runtime workers if ever needed.
    database_url: str = Field(
        default="sqlite+aiosqlite:///./tcsh.db",
        description="SQLAlchemy async URL for runtime queries.",
    )
    database_url_direct: str = Field(
        default="sqlite+aiosqlite:///./tcsh.db",
        description="SQLAlchemy async URL used by Alembic migrations.",
    )

    # ─── Local single-admin auth ─────────────────────────────────────────
    # JWTs are minted + verified with HS256 against `jwt_secret`. There is
    # one admin identity, configured via `admin_email` + `admin_password_hash`
    # (a bcrypt hash; generate with `uv run python -m tcsh_ar_api.create_admin`).
    # No user table — login compares against these env vars.
    # Intentionally no default — callers must supply JWT_SECRET in env.
    # In development you can set JWT_SECRET=change-me-development-only in
    # apps/api/.env; that value is detected by lifespan and raises in
    # non-development environments.
    jwt_secret: SecretStr = Field(
        default=SecretStr("change-me-development-only"),
        description=(
            "HS256 signing key for issued JWTs. Rotate in production. "
            "The default 'change-me-development-only' is intentionally "
            "well-known — the lifespan guard rejects this value outside "
            "APP_ENV=development."
        ),
    )
    admin_email: str = Field(
        default="admin@example.com",
        description="The single admin login email.",
    )
    admin_password_hash: str = Field(
        default="",
        description="bcrypt hash of the admin password (generated via the CLI helper).",
    )
    jwt_expires_seconds: int = Field(
        default=86400,
        description="Lifetime of issued JWTs in seconds (default 24h).",
    )

    # ─── Local texture storage ───────────────────────────────────────────
    # Texture bytes are persisted to the local filesystem at the path below
    # (created at startup). The runtime CWD is `apps/api/` for `make dev-api`,
    # so the default lands at `apps/api/storage/textures/`.
    texture_storage_dir: Path = Field(
        default=Path("storage/textures"),
        description="Directory where uploaded texture files are stored.",
    )

    # Texture upload policy — enforced server-side at the upload route.
    texture_allowed_mimes: list[str] = Field(
        default_factory=lambda: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/ktx2",
        ],
    )
    texture_max_size_bytes: int = Field(default=10 * 1024 * 1024)  # 10 MB

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])


@lru_cache
def get_settings() -> Settings:
    return Settings()
