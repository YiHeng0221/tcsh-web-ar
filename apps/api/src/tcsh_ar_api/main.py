from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from tcsh_ar_api import __version__
from tcsh_ar_api.anchors.router import router as anchors_router
from tcsh_ar_api.auth.service import get_jwt_service
from tcsh_ar_api.config import get_settings
from tcsh_ar_api.db import models as _db_models  # noqa: F401 — register all mappers
from tcsh_ar_api.health.router import router as health_router
from tcsh_ar_api.objects.router import router as objects_router

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Startup validation — assert auth settings are present so the first
    protected request doesn't surface a config error as 500. The JWKS URL
    itself is fetched lazily on first token verify; boot doesn't network.
    """
    get_jwt_service()  # raises RuntimeError if SUPABASE_JWKS_URL / SUPABASE_URL unset
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

app.include_router(health_router)
app.include_router(anchors_router, prefix="/api")
app.include_router(objects_router, prefix="/api")
