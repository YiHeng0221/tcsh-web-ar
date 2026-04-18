from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from tcsh_ar_api import __version__
from tcsh_ar_api.auth.service import get_jwt_service
from tcsh_ar_api.config import get_settings
from tcsh_ar_api.health.router import router as health_router

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Startup validation — fail loudly at boot rather than on first request."""
    get_jwt_service()  # raises RuntimeError if SUPABASE_JWKS_URL is unset
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
