from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from tcsh_ar_api import __version__
from tcsh_ar_api.anchors.router import router as anchors_router
from tcsh_ar_api.auth.router import router as auth_router
from tcsh_ar_api.config import get_settings
from tcsh_ar_api.db import models as _db_models  # noqa: F401 — register all mappers
from tcsh_ar_api.health.router import router as health_router
from tcsh_ar_api.objects.router import router as objects_router
from tcsh_ar_api.placements.router import router as placements_router
from tcsh_ar_api.textures.router import router as textures_router

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Startup checks:

    - Create the local texture storage directory if missing.
    - Warn (not crash) if the admin password hash is empty — the app still
      boots so /health works for ops, but `/auth/login` will reject every
      request until the env var is set.
    """
    settings.texture_storage_dir.mkdir(parents=True, exist_ok=True)
    if not settings.admin_password_hash:
        # Print rather than raise — easier dev UX for the very first run.
        print(
            "[tcsh-ar-api] WARNING: ADMIN_PASSWORD_HASH is not set. "
            "Generate one via `uv run python -m tcsh_ar_api.create_admin "
            "<email> <password>` and put it in apps/api/.env."
        )
    yield


app = FastAPI(
    title="tcsh-web-ar API",
    version=__version__,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Both the dev proxy (vite.config.ts) and production nginx
# (apps/web/nginx.conf) strip the `/api/` prefix before forwarding.
# The domain routers therefore mount at `/<domain>` on the FastAPI side;
# clients and proxies see `/api/<domain>`. Health is unprefixed so it
# can be reached directly by container health checks.
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(anchors_router)
app.include_router(objects_router)
app.include_router(placements_router)
app.include_router(textures_router)
